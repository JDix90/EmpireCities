/**
 * The translated-page guard (`translation_dom_guard_enabled`): a page the
 * browser translated used to crash whenever React removed a text node the
 * translator had replaced, or inserted an element in front of one.
 */
import { Component, useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { translatePage } from '../test/translatePage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/react', () => sentry);

import { installTranslationDomGuard, uninstallTranslationDomGuardForTests } from './translationDomGuard';

const setGuard = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, translation_dom_guard_enabled: on } }));

/** What the translator leaves: the text node gone, a <font> holding new words in its place. */
function translate(text: Text): HTMLElement {
  const font = document.createElement('font');
  font.textContent = `[${text.data}]`;
  text.replaceWith(font);
  return font;
}

/** The name of the error `fn` throws, or null. */
function thrown(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).name;
  }
}

// A fresh guard per test, so each sees a page load's first absorbed call.
beforeEach(() => installTranslationDomGuard());
afterEach(() => {
  uninstallTranslationDomGuardForTests();
  setGuard(true);
  sentry.captureMessage.mockClear();
});

describe('translation DOM guard', () => {
  it('lets the browser handle every call where the node is where React left it', () => {
    const parent = document.createElement('p');
    const a = parent.appendChild(document.createTextNode('a'));
    const b = document.createElement('b');
    expect(parent.insertBefore(b, a)).toBe(b);
    expect(parent.firstChild).toBe(b);
    expect(parent.removeChild(a)).toBe(a);
    expect(parent.childNodes.length).toBe(1);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('removes nothing for a text node the translator already replaced', () => {
    const parent = document.createElement('p');
    const text = parent.appendChild(document.createTextNode('Copied'));
    const font = translate(text);
    expect(parent.removeChild(text)).toBe(text);
    expect(parent.firstChild).toBe(font);
  });

  it('takes a text node out of the wrapper the translator put it in', () => {
    const parent = document.createElement('p');
    const text = parent.appendChild(document.createTextNode('Copied'));
    const font = document.createElement('font');
    parent.appendChild(font);
    font.appendChild(text);
    parent.removeChild(text);
    expect(text.parentNode).toBeNull();
    expect(parent.firstChild).toBe(font);
  });

  it('inserts in front of what holds the node now, or at the end when it is gone', () => {
    const parent = document.createElement('button');
    const wrapped = parent.appendChild(document.createTextNode('Tools'));
    const font = document.createElement('font');
    parent.appendChild(font);
    font.appendChild(wrapped);
    const icon = document.createElement('i');
    parent.insertBefore(icon, wrapped);
    expect([...parent.childNodes]).toEqual([icon, font]);

    const replaced = parent.appendChild(document.createTextNode('More'));
    const replacement = translate(replaced);
    const badge = document.createElement('b');
    parent.insertBefore(badge, replaced);
    expect([...parent.childNodes]).toEqual([icon, font, replacement, badge]);
  });

  it('reports the first absorbed call in a page load to Sentry, once', () => {
    const parent = document.createElement('p');
    const gone = parent.appendChild(document.createTextNode('gone'));
    translate(gone);
    parent.removeChild(gone);
    parent.insertBefore(document.createElement('i'), gone);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0][1]).toMatchObject({
      level: 'warning',
      tags: { translation_dom_guard: 'removeChild' },
    });
  });

  it('throws as the browser always did with the kill switch off', () => {
    setGuard(false);
    const parent = document.createElement('p');
    const text = parent.appendChild(document.createTextNode('Copied'));
    translate(text);
    expect(thrown(() => parent.removeChild(text))).toBe('NotFoundError');
    expect(thrown(() => parent.insertBefore(document.createElement('i'), text))).toBe('NotFoundError');
  });
});

/** Shows the error a commit threw, as the app's boundaries would catch it. */
class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p role="alert">{this.state.error.name}</p> : this.props.children;
  }
}

/** Both shapes React cannot survive on a translated page: a label that comes and goes, and an icon swapped in front of a label. */
function Toolbar() {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setCopied((v) => !v)}>
        Copy link{copied && ' (copied)'}
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown /> : <ChevronUp />}
        Tools
      </button>
    </div>
  );
}

describe('a translated page in React', () => {
  const play = () => {
    const { container } = render(<Catch><Toolbar /></Catch>);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    translatePage(container);
    const [copy, tools] = screen.getAllByRole('button');
    fireEvent.click(copy); // the "(copied)" text node goes
    fireEvent.click(tools); // a different icon goes in front of "Tools"
    return container;
  };

  it('carries on through both with the guard on', () => {
    const container = play();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('button:nth-of-type(2) svg')).not.toBeNull();
  });

  it('falls to the error screen without it', () => {
    setGuard(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    play();
    expect(screen.getByRole('alert').textContent).toBe('NotFoundError');
    vi.mocked(console.error).mockRestore();
  });
});

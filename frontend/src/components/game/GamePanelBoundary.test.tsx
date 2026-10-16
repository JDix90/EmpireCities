/**
 * A crash in one part of the game screen stays in that part: the rest of the
 * match keeps rendering, the panel offers Try again, and Sentry hears about it
 * as handled, tagged with the panel's name.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { translatePage } from '../../test/translatePage';

const sentry = vi.hoisted(() => ({ captureReactException: vi.fn() }));
vi.mock('@sentry/react', () => sentry);

import GamePanelBoundary from './GamePanelBoundary';

let broken = true;
function Flaky({ label = 'panel content' }: { label?: string }) {
  if (broken) throw new Error('boom');
  return <p>{label}</p>;
}

function Screen(props: Partial<React.ComponentProps<typeof GamePanelBoundary>>) {
  return (
    <div>
      <p>the map</p>
      <GamePanelBoundary name="hud" {...props}>
        <Flaky />
      </GamePanelBoundary>
    </div>
  );
}

beforeEach(() => {
  broken = true;
  sentry.captureReactException.mockClear();
  // React and the boundary both log the crash.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GamePanelBoundary', () => {
  it('renders its children untouched when nothing goes wrong', () => {
    broken = false;
    const { container } = render(<Screen />);
    expect(container.innerHTML).toBe('<div><p>the map</p><p>panel content</p></div>');
  });

  it('keeps the rest of the game on screen and swaps only the crashed panel for a notice', () => {
    render(<Screen />);
    expect(screen.getByText('the map')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This part of the game hit a problem.');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('reports the crash to Sentry as handled, tagged with the panel', () => {
    render(<Screen />);
    expect(sentry.captureReactException).toHaveBeenCalledTimes(1);
    const [error, info, hint] = sentry.captureReactException.mock.calls[0];
    expect((error as Error).message).toBe('boom');
    expect(info.componentStack).toContain('Flaky');
    expect(hint).toEqual({
      mechanism: { type: 'auto.function.react.error_boundary', handled: true },
      captureContext: { tags: { game_panel: 'hud' } },
    });
  });

  it('renders the panel again on Try again', () => {
    render(<Screen />);
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tries again by itself when its reset key changes', () => {
    const { rerender } = render(<Screen resetKey={7} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    broken = false;
    rerender(<Screen resetKey={7} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<Screen resetKey={8} />);
    expect(screen.getByText('panel content')).toBeInTheDocument();
  });

  it('floats an overlay notice that can close what crashed', () => {
    const onClose = vi.fn();
    render(<Screen variant="overlay" onClose={onClose} />);
    expect(screen.getByRole('alert').className).toContain('fixed');
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows nothing at all when silent', () => {
    const { container } = render(<Screen variant="silent" />);
    expect(container.innerHTML).toBe('<div><p>the map</p></div>');
    expect(sentry.captureReactException).toHaveBeenCalledTimes(1);
  });

  it('holds the crash a translated page causes in a commit, not only one in render', () => {
    // The Sentry crash: a chevron swapped in front of a text node that page
    // translation had replaced. React throws it while committing to the DOM.
    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown /> : <ChevronUp />}
          Tools
        </button>
      );
    }
    const { container } = render(
      <div>
        <p>the map</p>
        <GamePanelBoundary name="hud">
          <Toggle />
        </GamePanelBoundary>
      </div>,
    );
    translatePage(container);
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('the map')).toBeInTheDocument();
    expect((sentry.captureReactException.mock.calls[0][0] as Error).name).toBe('NotFoundError');
  });
});

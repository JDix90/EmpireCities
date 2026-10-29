/**
 * The lobby's top bar takes its two-row layout below 1280px, but whether one
 * row fits depends on what is in it: an admin's row ran 58px past a 1280px
 * screen before the Feedback entry, and further after it. The bar measures its
 * row and stacks whenever it does not fit, and goes back to one row once the
 * screen is wide enough for the row it measured.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopNavBar from './TopNavBar';

const sizes = { scroll: 0, client: 0 };
let observed: (() => void) | null = null;
const scrollDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
const clientDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.tagName === 'NAV' ? sizes.scroll : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) { return this.tagName === 'NAV' ? sizes.client : 0; },
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { observed = cb; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  if (scrollDesc) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollDesc);
  if (clientDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientDesc);
  vi.unstubAllGlobals();
  observed = null;
});

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <TopNavBar user={{ username: 'Ossawatomix' }} onLogout={() => {}} />
    </MemoryRouter>,
  );
}

describe('the lobby top bar', () => {
  it('keeps one row when it fits', () => {
    sizes.scroll = 1200;
    sizes.client = 1280;
    const { container } = renderBar();
    expect(container.querySelector('nav')?.dataset.stacked).toBeUndefined();
  });

  it('stacks when its one row runs past the screen, and unstacks once the screen fits it', () => {
    sizes.scroll = 1361;
    sizes.client = 1280;
    const { container } = renderBar();
    const nav = container.querySelector('nav')!;
    expect(nav.dataset.stacked).toBe('true');

    // Still too narrow for the row it measured: stays stacked.
    sizes.client = 1320;
    act(() => observed?.());
    expect(nav.dataset.stacked).toBe('true');

    // Wide enough: back to one row.
    sizes.client = 1440;
    act(() => observed?.());
    expect(nav.dataset.stacked).toBeUndefined();
  });
});

/**
 * A playtester "didn't immediately know how to switch to the world view" in
 * the Galactic Age. The tip points at the view tabs, whichever layout shows
 * them, and goes away on "Got it" or the close button.
 */
import React, { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GalaxyViewsTip from './GalaxyViewsTip';

function anchorAt(rect: { left: number; width: number; bottom: number } | null) {
  const ref = createRef<HTMLElement>();
  const el = document.createElement('div');
  el.getBoundingClientRect = () => (rect
    ? { left: rect.left, width: rect.width, right: rect.left + rect.width, bottom: rect.bottom, top: rect.bottom - 40, height: 40, x: rect.left, y: rect.bottom - 40, toJSON: () => ({}) }
    : { left: 0, width: 0, right: 0, bottom: 0, top: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (ref as { current: HTMLElement | null }).current = el;
  return ref;
}

const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');

describe('GalaxyViewsTip', () => {
  afterEach(() => {
    if (width) Object.defineProperty(window, 'innerWidth', width);
  });

  it('sits under the tabs on screen, skipping the layout that is hidden', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const hidden = anchorAt(null);
    const strip = anchorAt({ left: 0, width: 390, bottom: 96 });
    render(<GalaxyViewsTip anchors={[hidden, strip]} onDismiss={() => {}} />);
    const tip = screen.getByTestId('galaxy-views-tip');
    expect(tip.style.top).toBe('106px');
    // Centred under the strip, and inside the screen.
    expect(tip.style.left).toBe('51px');
    expect(tip.textContent).toMatch(/Switch views here/);
    expect(tip.textContent).toMatch(/Pick a world to play on its map up close, or Galaxy chart/);
  });

  it('stays on screen under tabs at the right edge of a desktop bar', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    const tabs = anchorAt({ left: 1100, width: 250, bottom: 52 });
    render(<GalaxyViewsTip anchors={[tabs]} onDismiss={() => {}} />);
    const left = parseFloat(screen.getByTestId('galaxy-views-tip').style.left);
    expect(left + 288).toBeLessThanOrEqual(1366 - 8);
  });

  it('shows nothing when no tabs are on screen', () => {
    render(<GalaxyViewsTip anchors={[anchorAt(null)]} onDismiss={() => {}} />);
    expect(screen.queryByTestId('galaxy-views-tip')).toBeNull();
  });

  it('closes on Got it, and on the close button', () => {
    const onDismiss = vi.fn();
    render(<GalaxyViewsTip anchors={[anchorAt({ left: 0, width: 390, bottom: 96 })]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

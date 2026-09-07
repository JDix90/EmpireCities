import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickPlace } from './TerritoryPanel';

/**
 * The control this replaces committed on every button: +1 / +5 / Place all.
 * Any amount that was not 1, 5 or the whole pool meant pressing +1 repeatedly,
 * each press a server round trip that re-rendered the panel mid-click. These
 * pin the property that fixes it — one commit, whatever the amount.
 */
function setup(pool: number, onPlace = vi.fn(), extra: Record<string, unknown> = {}) {
  render(<QuickPlace pool={pool} onPlace={onPlace} {...extra} />);
  return { onPlace };
}
const inc = () => fireEvent.click(screen.getByTestId('draft-amount-inc'));
const dec = () => fireEvent.click(screen.getByTestId('draft-amount-dec'));
const amount = () => screen.getByTestId('draft-amount').textContent;

describe('QuickPlace', () => {
  it('places a middling amount in one call, not one call per unit', () => {
    const { onPlace } = setup(5);
    inc(); inc();
    expect(amount()).toBe('3');
    fireEvent.click(screen.getByTestId('draft-place'));
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith(3);
  });

  it('still puts a single unit down in one press', () => {
    const { onPlace } = setup(5);
    expect(amount()).toBe('1');
    fireEvent.click(screen.getByTestId('draft-place'));
    expect(onPlace).toHaveBeenCalledWith(1);
  });

  it('never dials past the pool, in any direction', () => {
    setup(3);
    inc(); inc(); inc(); inc();
    expect(amount()).toBe('3');
    expect(screen.getByTestId('draft-amount-inc')).toBeDisabled();
    dec(); dec(); dec(); dec();
    expect(amount()).toBe('1');
    expect(screen.getByTestId('draft-amount-dec')).toBeDisabled();
  });

  it('offers the +5 jump only when there are five to jump', () => {
    const { unmount } = render(<QuickPlace pool={4} onPlace={vi.fn()} />);
    expect(screen.queryByTestId('draft-amount-plus5')).toBeNull();
    unmount();
    setup(9);
    fireEvent.click(screen.getByTestId('draft-amount-plus5'));
    expect(amount()).toBe('6');
  });

  it('fills to the whole pool and says how many that is', () => {
    const { onPlace } = setup(7);
    const all = screen.getByTestId('draft-amount-all');
    expect(all).toHaveTextContent('All 7');
    fireEvent.click(all);
    expect(amount()).toBe('7');
    fireEvent.click(screen.getByTestId('draft-place'));
    expect(onPlace).toHaveBeenCalledWith(7);
  });

  it('resets to one after a placement, so the next click cannot dump a stack', () => {
    const { onPlace } = setup(9);
    fireEvent.click(screen.getByTestId('draft-amount-all'));
    fireEvent.click(screen.getByTestId('draft-place'));
    expect(onPlace).toHaveBeenCalledWith(9);
    expect(amount()).toBe('1');
  });

  it('clamps the dial down when the pool shrinks under it', () => {
    // The pool changes as placements land and when another territory is
    // selected; a stale "Place 8" against 2 remaining would over-commit.
    const { rerender } = render(<QuickPlace pool={8} onPlace={vi.fn()} />);
    fireEvent.click(screen.getByTestId('draft-amount-all'));
    expect(amount()).toBe('8');
    rerender(<QuickPlace pool={2} onPlace={vi.fn()} />);
    expect(amount()).toBe('2');
    expect(screen.getByTestId('draft-place')).toHaveTextContent('Place 2');
  });

  it('keeps Undo for the committed placement, disabled when there is nothing to revert', () => {
    const onUndo = vi.fn();
    const { unmount } = render(<QuickPlace pool={3} onPlace={vi.fn()} onUndo={onUndo} canUndo={false} />);
    expect(screen.getByTestId('draft-undo')).toBeDisabled();
    unmount();
    render(<QuickPlace pool={3} onPlace={vi.fn()} onUndo={onUndo} canUndo />);
    fireEvent.click(screen.getByTestId('draft-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

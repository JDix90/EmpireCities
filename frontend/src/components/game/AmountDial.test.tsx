import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountDial } from './TerritoryPanel';

/**
 * The dial behind both draft placement and fortify.
 *
 * Fortify is why it is shared: on mobile the amount stepper was hidden the
 * moment the destination picker had any entries, and the picker commits the
 * move as soon as a destination is tapped — so every fortify on a phone sent
 * exactly one unit, with nothing on screen able to change it.
 */
function setup(max: number, value = 1) {
  const onChange = vi.fn();
  const { rerender } = render(
    <AmountDial max={max} value={value} onChange={onChange} testIdPrefix="fortify" allLabel={`All ${max}`} />,
  );
  return {
    onChange,
    show: (v: number) => rerender(
      <AmountDial max={max} value={v} onChange={onChange} testIdPrefix="fortify" allLabel={`All ${max}`} />,
    ),
  };
}
const amount = () => screen.getByTestId('fortify-amount').textContent;

describe('AmountDial', () => {
  it('reports each step to its owner rather than holding the value itself', () => {
    // Fortify's amount has to survive the picker re-rendering beneath it, so
    // the caller owns the number.
    const { onChange } = setup(8, 3);
    fireEvent.click(screen.getByTestId('fortify-amount-inc'));
    expect(onChange).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByTestId('fortify-amount-dec'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('jumps five at a time, and all the way', () => {
    const { onChange } = setup(9, 2);
    fireEvent.click(screen.getByTestId('fortify-amount-plus5'));
    expect(onChange).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByTestId('fortify-amount-all'));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('goes dead at the ceiling instead of offering units the source cannot spare', () => {
    const { show } = setup(6, 6);
    expect(screen.getByTestId('fortify-amount-inc')).toBeDisabled();
    expect(screen.getByTestId('fortify-amount-all')).toBeDisabled();
    expect(screen.getByTestId('fortify-amount-plus5')).toBeDisabled();

    show(1);
    expect(screen.getByTestId('fortify-amount-dec')).toBeDisabled();
  });

  it('clamps a jump that would overshoot rather than refusing it', () => {
    const { onChange } = setup(6, 4);
    fireEvent.click(screen.getByTestId('fortify-amount-plus5'));
    expect(onChange).toHaveBeenLastCalledWith(6);
  });

  it('displays a stale value clamped, so a shrunken source cannot show a lie', () => {
    // The owner also clamps on change, but a source swap can hand us a value
    // from the previous, larger territory for a render.
    setup(2, 7);
    expect(amount()).toBe('2');
  });

  it('hides the +5 shortcut when there is not that much to move', () => {
    setup(4);
    expect(screen.queryByTestId('fortify-amount-plus5')).not.toBeInTheDocument();
  });

  it('keeps each caller on its own test ids', () => {
    render(<AmountDial max={5} value={1} onChange={vi.fn()} testIdPrefix="draft" allLabel="All 5" />);
    expect(screen.getByTestId('draft-amount')).toBeInTheDocument();
  });
});

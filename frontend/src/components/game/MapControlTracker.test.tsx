import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapControlChip, describeMapControl } from './MapControlTracker';

const progress = { held: 18, total: 42, heldPct: 42, thresholdPct: 65, needed: 28, remaining: 10 };

describe('MapControlChip', () => {
  it('shows the share held over the share that wins, and says both in words', () => {
    render(<MapControlChip progress={progress} />);
    const meter = screen.getByRole('meter', { name: 'Map control' });
    expect(meter).toHaveTextContent('42%/65%');
    expect(meter).toHaveAttribute('aria-valuetext', 'You hold 42% of the map. 65% wins — 10 more territories.');
  });
});

describe('describeMapControl', () => {
  it('counts the last territory in the singular', () => {
    expect(describeMapControl({ ...progress, held: 27, heldPct: 64, remaining: 1 }))
      .toBe('You hold 64% of the map. 65% wins — 1 more territory.');
  });

  it('drops the countdown once the threshold is met', () => {
    expect(describeMapControl({ ...progress, held: 28, heldPct: 66, remaining: 0 }))
      .toBe('You hold 66% of the map — 65% wins.');
  });
});

/**
 * The replay's tip card sits at the foot of the map it is rendered in, on
 * every screen. Fixed at a height above the bottom of the screen, it covered a
 * phone's play button and, on a tablet or a short window, the turn chips and
 * the timeline under the map.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReplayTipToast from './ReplayTipToast';
import type { ReplayInsight } from './ReplayInsightsPanel';

const tip: ReplayInsight = {
  turn: 2,
  title: 'Decisive attack — gained ground',
  impact: 'medium',
  explanation: 'Blitzed Britannia into Scandinavia with 15 units.',
  alternative: 'Pressure adjacent weak borders next turn.',
};

describe('ReplayTipToast', () => {
  it.each([
    ['a phone', true],
    ['a larger screen', false],
  ])('sits inside the map on %s, never fixed to the screen', (_name, docked) => {
    render(<ReplayTipToast insight={tip} onClose={() => {}} autoDismissMs={0} docked={docked} />);
    const card = screen.getByRole('status');
    expect(card).toHaveClass('absolute');
    expect(card).not.toHaveClass('fixed');
  });

  it('keeps to the title and what to try on a phone, the whole tip on a larger screen', () => {
    const { unmount } = render(<ReplayTipToast insight={tip} onClose={() => {}} autoDismissMs={0} docked />);
    expect(screen.getByText(/Blitzed Britannia/)).toHaveClass('hidden');
    unmount();
    render(<ReplayTipToast insight={tip} onClose={() => {}} autoDismissMs={0} />);
    expect(screen.getByText(/Blitzed Britannia/)).not.toHaveClass('hidden');
  });
});

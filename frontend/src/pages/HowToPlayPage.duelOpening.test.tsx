/**
 * The two-player opening balance (duel_opening_enabled) is stated once, in
 * How to Play's turn structure, and only while it is live.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HowToPlayPage from './HowToPlayPage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

/** Open the Turn Structure section, collapsed by default, as a reader would. */
function openTurnStructure() {
  render(<MemoryRouter><HowToPlayPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Turn Structure/ }));
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, duel_opening_enabled: on } }));

describe('How to Play and the two-player opening', () => {
  afterEach(() => setFlag(false));

  it('states the rule beside the turn order while the flag is on', () => {
    setFlag(true);
    openTurnStructure();
    expect(screen.getByTestId('duel-opening-rule')).toHaveTextContent(
      /first player places at most 3 units on their opening turn \(4 on the Modern map\) and the second player places 1 extra on theirs/,
    );
  });

  it('says nothing while it is off', () => {
    openTurnStructure();
    expect(screen.getByText(/chosen at random/)).toBeInTheDocument();
    expect(screen.queryByTestId('duel-opening-rule')).toBeNull();
  });
});

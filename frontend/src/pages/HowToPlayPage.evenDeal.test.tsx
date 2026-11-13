/**
 * The even deal (even_deal_enabled) is stated once, in How to Play's turn
 * structure, and only while it is live.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HowToPlayPage from './HowToPlayPage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

function openTurnStructure() {
  render(<MemoryRouter><HowToPlayPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Turn Structure/ }));
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, even_deal_enabled: on } }));

describe('How to Play and the even deal', () => {
  afterEach(() => setFlag(false));

  it('says what happens to a leftover territory while the flag is on', () => {
    setFlag(true);
    openTurnStructure();
    expect(screen.getByTestId('even-deal-rule')).toHaveTextContent(
      /the one left over starts neutral with 3 units, and either player may take it/,
    );
  });

  it('says nothing while it is off', () => {
    openTurnStructure();
    expect(screen.getByText(/chosen at random/)).toBeInTheDocument();
    expect(screen.queryByTestId('even-deal-rule')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { turnTimeoutToastMessage } from './turnTimeout';

describe('turnTimeoutToastMessage', () => {
  it('says the turn ended, and what was placed for the player', () => {
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'next_turn', appliedDraft: true, unitsPlaced: 5 }))
      .toBe("Time's up — 5 units auto-placed, and your turn ended.");
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'next_turn', appliedDraft: true, unitsPlaced: 1 }))
      .toContain('1 unit auto-placed');
  });

  it('announces the turn passing when nothing was left to place', () => {
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'next_turn' })).toBe(
      "Time's up — your turn ended and play passed to the next player.",
    );
  });

  it('shows nothing for the per-phase payloads an older server sent', () => {
    // Those promised "a fresh clock" for the next phase, which no longer exists.
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'attack', appliedDraft: true, unitsPlaced: 5 })).toBeNull();
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'mystery' })).toBeNull();
  });
});

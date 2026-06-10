import { describe, it, expect } from 'vitest';
import { turnTimeoutToastMessage } from './turnTimeout';

describe('turnTimeoutToastMessage', () => {
  it('explains auto-placed draft units when the draft clock expires', () => {
    expect(
      turnTimeoutToastMessage({ phaseAdvanced: 'attack', appliedDraft: true, unitsPlaced: 5 }),
    ).toBe('Draft time expired — 5 units auto-placed. Attack phase started with a fresh clock.');
  });

  it('singularizes a single auto-placed unit', () => {
    expect(
      turnTimeoutToastMessage({ phaseAdvanced: 'attack', appliedDraft: true, unitsPlaced: 1 }),
    ).toContain('1 unit auto-placed');
  });

  it('announces the attack timeout without draft details', () => {
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'fortify' })).toBe(
      'Attack time expired — fortify phase started with a fresh clock.',
    );
  });

  it('announces the turn passing on a fortify timeout', () => {
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'next_turn' })).toContain('your turn ended');
  });

  it('returns null for unknown phases', () => {
    expect(turnTimeoutToastMessage({ phaseAdvanced: 'mystery' })).toBeNull();
  });
});

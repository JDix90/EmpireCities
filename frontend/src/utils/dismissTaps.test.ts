import { describe, it, expect } from 'vitest';
import type { ModalData } from '../components/game/ActionModal';
import { countTap, dismissTierOf, emptyTally, tallyProperties } from './dismissTaps';

const combat = (capitalLost = false): ModalData =>
  ({ type: 'combat', result: { capitalLost, attacker_rolls: [], defender_rolls: [] } } as unknown as ModalData);

describe('dismissTierOf', () => {
  it('puts the must-acknowledge modals in tier 1', () => {
    for (const type of ['game_over', 'elimination', 'resign_confirm', 'era_advance'] as const) {
      expect(dismissTierOf({ type } as unknown as ModalData), type).toBe(1);
    }
    expect(dismissTierOf(combat(true))).toBe(1);
  });

  it("puts the player's own attack result in tier 2", () => {
    expect(dismissTierOf(combat())).toBe(2);
  });

  it('counts the two summaries as glanceable, unlike isCriticalModal', () => {
    expect(dismissTierOf({ type: 'turn_summary' } as unknown as ModalData)).toBe(3);
    expect(dismissTierOf({ type: 'draft_summary' } as unknown as ModalData)).toBe(3);
  });
});

describe('the tally', () => {
  it('counts per tier and reports strings the endpoint accepts', () => {
    const tally = emptyTally();
    countTap(tally, 3);
    countTap(tally, 3);
    countTap(countTap(tally, 2), 1);
    expect(tally).toEqual({ tier1: 1, tier2: 1, tier3: 2 });
    expect(tallyProperties(tally, { turn: 7, era: 'ancient', isTutorial: false })).toEqual({
      layout: 'phone',
      turn: '7',
      tier1: '1',
      tier2: '1',
      tier3: '2',
      era: 'ancient',
      is_tutorial: 'false',
    });
  });

  it('reports a quiet round too: the zeros are the denominator', () => {
    const props = tallyProperties(emptyTally(), { turn: 3, era: undefined, isTutorial: true });
    expect(props).toMatchObject({ turn: '3', tier1: '0', tier2: '0', tier3: '0', era: '', is_tutorial: 'true' });
    for (const v of Object.values(props)) expect(typeof v).toBe('string');
  });
});

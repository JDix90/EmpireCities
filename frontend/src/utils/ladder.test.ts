import { describe, it, expect, vi } from 'vitest';
import { fetchLadderRung, isLadderGame, ladderRungFromStats, nextBattleLabel } from './ladder';

describe('ladderRungFromStats (first_match_ladder_enabled)', () => {
  it('keeps a player on the first match until their first win, then one battle more', () => {
    expect(ladderRungFromStats({ overall: { played: 3, won: 0 } })).toBe(1);
    expect(ladderRungFromStats({ overall: { played: 4, won: 1 } })).toBe(2);
    expect(ladderRungFromStats({ overall: { played: 9, won: 2 } })).toBeNull();
  });

  it('says nothing for a response it cannot read', () => {
    expect(ladderRungFromStats(null)).toBeUndefined();
    expect(ladderRungFromStats({ overall: {} })).toBeUndefined();
  });
});

describe('fetchLadderRung', () => {
  it('leaves a player who set up Quick Match themselves to their own setup', async () => {
    const get = vi.fn();
    await expect(fetchLadderRung(get, true)).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('reads the rung from the player’s stats, and falls back to the ordinary Quick Match on an error', async () => {
    await expect(fetchLadderRung(async () => ({ data: { overall: { won: 1 } } }), false)).resolves.toBe(2);
    await expect(fetchLadderRung(async () => { throw new Error('offline'); }, false)).resolves.toBeNull();
  });
});

describe('the results screen’s ladder button', () => {
  it('offers the same battle after a loss and the next after a win', () => {
    expect(nextBattleLabel(false)).toBe('Try again');
    expect(nextBattleLabel(true)).toBe('Next battle');
  });

  it('shows on the ladder’s games only', () => {
    expect(isLadderGame({ first_match: true })).toBe(true);
    expect(isLadderGame({ ladder_step: 2 })).toBe(true);
    expect(isLadderGame({})).toBe(false);
    expect(isLadderGame(null)).toBe(false);
  });
});

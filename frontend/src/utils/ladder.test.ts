import { describe, it, expect, vi } from 'vitest';
import {
  LADDER_RUNG_2_BATTLE,
  fetchLadderRung,
  isLadderGame,
  ladderBattle,
  ladderRungFromStats,
  nextBattleLabel,
} from './ladder';

describe('ladderRungFromStats (first_match_ladder_enabled)', () => {
  it('keeps a player on the first match until their first win, then one battle more', () => {
    expect(ladderRungFromStats({ overall: { played: 3, won: 0 } })).toBe(1);
    expect(ladderRungFromStats({ overall: { played: 4, won: 1 } })).toBe(2);
    expect(ladderRungFromStats({ overall: { played: 9, won: 2 } })).toBeNull();
  });

  it('adds a third battle, until the third win, with the map ladder', () => {
    expect(ladderRungFromStats({ overall: { won: 0 } }, true)).toBe(1);
    expect(ladderRungFromStats({ overall: { won: 1 } }, true)).toBe(2);
    expect(ladderRungFromStats({ overall: { won: 2 } }, true)).toBe(3);
    expect(ladderRungFromStats({ overall: { won: 3 } }, true)).toBeNull();
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
    await expect(fetchLadderRung(async () => ({ data: { overall: { won: 2 } } }), false)).resolves.toBeNull();
    await expect(fetchLadderRung(async () => ({ data: { overall: { won: 2 } } }), false, true)).resolves.toBe(3);
    await expect(fetchLadderRung(async () => { throw new Error('offline'); }, false)).resolves.toBeNull();
  });
});

describe('ladderBattle (first_match_ladder_maps_enabled)', () => {
  it('is one Medium bot on Britain after the first win without the map ladder, and nothing after', () => {
    expect(ladderBattle(2, false)).toBe(LADDER_RUNG_2_BATTLE);
    expect(LADDER_RUNG_2_BATTLE).toMatchObject({
      step: 2,
      mapId: 'community_britain_925',
      prefs: { aiCount: 1, aiDifficulty: 'medium' },
    });
    expect(ladderBattle(3, false)).toBeNull();
  });

  it('grows the board with the map ladder: China, then Japan, one Easy bot each', () => {
    expect(ladderBattle(2, true)).toMatchObject({
      step: 2,
      eraId: 'modern',
      mapId: 'community_fractured_china',
      prefs: { aiCount: 1, aiDifficulty: 'easy', victory: 'majority' },
    });
    expect(ladderBattle(3, true)).toMatchObject({
      step: 3,
      eraId: 'medieval',
      mapId: 'community_sengoku_japan',
      prefs: { aiCount: 1, aiDifficulty: 'easy', victory: 'majority' },
    });
    expect(ladderBattle(3, true)!.buttonLine).toBe('Battle 3 · vs 1 Easy AI · Sengoku Japan');
  });

  it('has no battle for the first match or past the ladder', () => {
    for (const maps of [false, true]) {
      expect(ladderBattle(1, maps)).toBeNull();
      expect(ladderBattle(null, maps)).toBeNull();
      expect(ladderBattle(undefined, maps)).toBeNull();
    }
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
    expect(isLadderGame({ ladder_step: 3 })).toBe(true);
    expect(isLadderGame({ ladder_step: 4 })).toBe(false);
    expect(isLadderGame({})).toBe(false);
    expect(isLadderGame(null)).toBe(false);
  });
});

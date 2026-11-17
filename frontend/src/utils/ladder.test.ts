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

  it('climbs a rung each win to the fifth battle with the map ladder, then lets go', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((won) => ladderRungFromStats({ overall: { won } }, true))).toEqual([1, 2, 3, 4, 5, null, null]);
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
    await expect(fetchLadderRung(async () => ({ data: { overall: { won: 4 } } }), false, true)).resolves.toBe(5);
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
    for (const rung of [3, 4, 5] as const) expect(ladderBattle(rung, false)).toBeNull();
  });

  it('grows the board with the map ladder against one Easy bot, then steps the bot up on a world map', () => {
    const battles = ([2, 3, 4, 5] as const).map((rung) => ladderBattle(rung, true)!);
    expect(battles.map((b) => [b.step, b.eraId, b.mapId, b.prefs.aiCount, b.prefs.aiDifficulty, b.prefs.victory])).toEqual([
      [2, 'modern', 'community_balkanized_spain', 1, 'easy', 'majority'],
      [3, 'modern', 'community_fractured_china', 1, 'easy', 'majority'],
      [4, 'medieval', 'community_sengoku_japan', 1, 'easy', 'majority'],
      [5, 'medieval', 'era_medieval', 1, 'medium', 'majority'],
    ]);
    expect(battles.map((b) => b.buttonLine)).toEqual([
      'Battle 2 · vs 1 Easy AI · Balkanized Spain',
      'Battle 3 · vs 1 Easy AI · Fractured China',
      'Battle 4 · vs 1 Easy AI · Sengoku Japan',
      'Battle 5 · vs 1 Medium AI · Medieval world',
    ]);
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
    expect(isLadderGame({ ladder_step: 5 })).toBe(true);
    expect(isLadderGame({ ladder_step: 6 })).toBe(false);
    expect(isLadderGame({ ladder_step: 2.5 })).toBe(false);
    expect(isLadderGame({})).toBe(false);
    expect(isLadderGame(null)).toBe(false);
  });
});

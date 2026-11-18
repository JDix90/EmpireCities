import { describe, it, expect, vi } from 'vitest';
import {
  LADDER_RUNG_2_BATTLE,
  NEXT_MATCH_TITLES,
  fetchLadderRung,
  fetchNextMatchKind,
  nextMatchKind,
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

  it('counts wins off the ladder counts when the server sends them: a campaign stage won is not a rung', () => {
    expect(ladderRungFromStats({ overall: { played: 2, won: 2 }, ladder: { played: 0, won: 0 } })).toBe(1);
    expect(ladderRungFromStats({ overall: { played: 5, won: 3 }, ladder: { played: 2, won: 1 } })).toBe(2);
  });

  it('climbs a rung each win to the sixth battle with the map ladder, then lets go', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((won) => ladderRungFromStats({ overall: { won } }, true))).toEqual([1, 2, 3, 4, 5, 6, null, null]);
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
    await expect(fetchLadderRung(async () => ({ data: { overall: { won: 5 } } }), false, true)).resolves.toBe(6);
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
    for (const rung of [3, 4, 5, 6] as const) expect(ladderBattle(rung, false)).toBeNull();
  });

  it('grows the board with the map ladder against one Easy bot, then steps the bots up on a world map', () => {
    const battles = ([2, 3, 4, 5, 6] as const).map((rung) => ladderBattle(rung, true)!);
    expect(battles.map((b) => [b.step, b.eraId, b.mapId, b.prefs.aiCount, b.prefs.aiDifficulty, b.prefs.victory])).toEqual([
      [2, 'modern', 'community_balkanized_spain', 1, 'easy', 'majority'],
      [3, 'modern', 'community_fractured_china', 1, 'easy', 'majority'],
      [4, 'medieval', 'community_sengoku_japan', 1, 'easy', 'majority'],
      [5, 'medieval', 'era_medieval', 1, 'medium', 'majority'],
      [6, 'medieval', 'era_medieval', 2, 'medium', 'majority'],
    ]);
    expect(battles.map((b) => b.buttonLine)).toEqual([
      'Battle 2 · vs 1 Easy AI · Balkanized Spain',
      'Battle 3 · vs 1 Easy AI · Fractured China',
      'Battle 4 · vs 1 Easy AI · Sengoku Japan',
      'Battle 5 · vs 1 Medium AI · Medieval world',
      'Battle 6 · vs 2 Medium AI · Medieval world',
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
    expect(isLadderGame({ ladder_step: 6 })).toBe(true);
    expect(isLadderGame({ ladder_step: 7 })).toBe(false);
    expect(isLadderGame({ ladder_step: 2.5 })).toBe(false);
    expect(isLadderGame({})).toBe(false);
    expect(isLadderGame(null)).toBe(false);
  });
});

describe('the next match, named (lobby button and tutorial wrap-up)', () => {
  const stats = (won: number, played = won) => async () => ({ data: { overall: { played, won } } });
  const flags = { firstMatchEasy: true, ladder: true, ladderMaps: true };

  it('names the first match, a later battle, and the player\u2019s own Quick Match', () => {
    expect(NEXT_MATCH_TITLES[nextMatchKind(true, null)]).toBe('First Match');
    expect(NEXT_MATCH_TITLES[nextMatchKind(false, LADDER_RUNG_2_BATTLE)]).toBe('Next Battle');
    expect(NEXT_MATCH_TITLES[nextMatchKind(false, null)]).toBe('Quick Match');
    // Not yet known reads as the ordinary Quick Match, as the lobby starts it.
    expect(nextMatchKind(null, null)).toBe('quick');
  });

  it('reads it as the lobby does: the first match until the first win, the ladder, then Quick Match', async () => {
    await expect(fetchNextMatchKind(stats(0, 3), false, flags)).resolves.toBe('first');
    await expect(fetchNextMatchKind(stats(2), false, flags)).resolves.toBe('ladder');
    await expect(fetchNextMatchKind(stats(6), false, flags)).resolves.toBe('quick');
    // Without the map ladder the ladder ends after its second battle.
    await expect(fetchNextMatchKind(stats(1), false, { ...flags, ladderMaps: false })).resolves.toBe('ladder');
    await expect(fetchNextMatchKind(stats(2), false, { ...flags, ladderMaps: false })).resolves.toBe('quick');
  });

  it('keeps a player who set up Quick Match themselves on it, without asking', async () => {
    const get = vi.fn();
    await expect(fetchNextMatchKind(get, true, flags)).resolves.toBe('quick');
    await expect(fetchNextMatchKind(get, true, { ...flags, ladder: false })).resolves.toBe('quick');
    expect(get).not.toHaveBeenCalled();
  });

  it('follows the flags: no first match without first_match_easy_enabled, no ladder without its own', async () => {
    const get = vi.fn(stats(0));
    await expect(fetchNextMatchKind(get, false, { ...flags, firstMatchEasy: false })).resolves.toBe('quick');
    expect(get).not.toHaveBeenCalled();
    await expect(fetchNextMatchKind(stats(0), false, { ...flags, ladder: false })).resolves.toBe('first');
    await expect(fetchNextMatchKind(stats(1), false, { ...flags, ladder: false })).resolves.toBe('quick');
  });

  it('falls back to the ordinary Quick Match when the stats cannot be read', async () => {
    await expect(fetchNextMatchKind(async () => { throw new Error('offline'); }, false, flags)).resolves.toBe('quick');
  });
});

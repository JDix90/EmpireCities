/**
 * The tutorial is a lesson, not a game: it unlocks tutorial_complete and
 * nothing else (PT-008). Its guaranteed win used to grant First Blood,
 * Conqueror, Speed Demon and Ancient Master while the profile's stats and
 * the First Victory quest, which skip tutorial games, said no game had been
 * won yet. The fake client answers every count with "none" (or what a case
 * sets), defines every achievement but those a case leaves out, and records
 * the inserts, which is all these cases need.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import type { GameState, PlayerState } from '../../types';
import {
  checkAndUnlockAchievements, grantAchievements, grantAchievementsOutsideGame, type AchievementContext,
} from './achievementService';

const transaction = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres', () => ({ withTransaction: transaction, pgPool: {} }));

function fakeClient(opts: { priorRankedWins?: number; recentWins?: boolean[]; undefinedIds?: string[] } = {}) {
  const inserted: string[] = [];
  const sql: string[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      sql.push(text);
      if (text.includes('INSERT INTO user_achievements')) {
        inserted.push(String(params[1]));
        return { rowCount: 1, rows: [{ achievement_id: params[1] }] };
      }
      if (text.includes('FROM achievements')) {
        const ids = (params[0] as string[]).filter((id) => !opts.undefinedIds?.includes(id));
        return { rowCount: ids.length, rows: ids.map((achievement_id) => ({ achievement_id, xp_reward: 0 })) };
      }
      if (text.includes('SELECT xp FROM users')) return { rowCount: 1, rows: [{ xp: 0 }] };
      if (text.includes('g.is_ranked = true')) return { rowCount: 1, rows: [{ cnt: String(opts.priorRankedWins ?? 0) }] };
      if (text.includes('AS won')) {
        const rows = (opts.recentWins ?? []).map((won) => ({ won }));
        return { rowCount: rows.length, rows };
      }
      if (text.includes('COUNT(*)')) return { rowCount: 1, rows: [{ cnt: '0' }] };
      return { rowCount: 0, rows: [] };
    },
  } as unknown as PoolClient;
  return { client, inserted, sql };
}

function wonGame(tutorial: boolean): GameState {
  return {
    era: 'ancient',
    turn_number: 4,
    settings: { tutorial: tutorial || undefined, diplomacy_enabled: false },
    players: [
      { player_id: 'me', player_index: 0, username: 'me', is_ai: false, is_eliminated: false, territory_count: 6, cards: [] },
      { player_id: 'bot', player_index: 1, username: 'bot', is_ai: true, is_eliminated: true, territory_count: 0, cards: [] },
    ],
    territories: {
      a: { territory_id: 'a', owner_id: 'me', unit_count: 3 },
      b: { territory_id: 'b', owner_id: 'me', unit_count: 2 },
    },
    win_probability_history: [],
  } as unknown as GameState;
}

const ctx = (gameState: GameState, over: Partial<AchievementContext> = {}): AchievementContext => ({
  userId: 'me', gameId: 'g1', gameState, winnerId: 'me', rank: 1, totalPlayers: 2,
  gameType: 'solo', isRanked: false, playerMu: 1500, playerMuBefore: 1500, strongestOpponentMuBefore: -Infinity,
  ...over,
});

/** `wonGame(false)` with the player's tallies and the turn set. */
function realWin(me: Partial<PlayerState>, turn = 4): GameState {
  const state = wonGame(false);
  state.turn_number = turn;
  Object.assign(state.players[0], me);
  return state;
}

describe('checkAndUnlockAchievements', () => {
  it('grants the win achievements for a real first win', async () => {
    const { client, inserted } = fakeClient();
    const unlocked = await checkAndUnlockAchievements(client, ctx(wonGame(false)));
    expect(unlocked).toEqual(expect.arrayContaining(['first_blood', 'conqueror', 'speed_demon', 'ancient_master']));
    expect(inserted).not.toContain('tutorial_complete');
  });

  it('grants only tutorial_complete for the tutorial, and never touches the win counters', async () => {
    const { client, inserted, sql } = fakeClient();
    const unlocked = await checkAndUnlockAchievements(client, ctx(wonGame(true)));
    expect(unlocked).toEqual(['tutorial_complete']);
    expect(inserted).toEqual(['tutorial_complete']);
    expect(sql.some((q) => q.includes('COUNT(*)'))).toBe(false);
  });

  it('counts prior wins without tutorial games, so the first real win is still first', async () => {
    const { client, sql } = fakeClient();
    await checkAndUnlockAchievements(client, ctx(wonGame(false)));
    const priorWins = sql.find((q) => q.includes('final_rank = 1') && q.includes('COUNT(*)'));
    expect(priorWins).toContain("settings_json::jsonb->>'tutorial'");
  });

  it('grants First Steps only for a tutorial game the player won', async () => {
    const { client, inserted } = fakeClient();
    const unlocked = await checkAndUnlockAchievements(client, ctx(wonGame(true), { rank: 2 }));
    expect(unlocked).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('grants Unstoppable at ten straight wins and Immortal Streak at twenty-five', async () => {
    const at = async (recentWins: boolean[]) => {
      const { client } = fakeClient({ recentWins });
      return checkAndUnlockAchievements(client, ctx(wonGame(false)));
    };
    const ten = await at([...Array(10).fill(true), false, ...Array(14).fill(true)]);
    expect(ten).toContain('ten_streak');
    expect(ten).not.toContain('immortal_streak');
    const twentyFive = await at(Array(25).fill(true));
    expect(twentyFive).toEqual(expect.arrayContaining(['ten_streak', 'immortal_streak']));
    expect(await at([false, ...Array(24).fill(true)])).not.toContain('ten_streak');
  });

  it('grants Warlord for the fiftieth ranked win at a rating of 1800 or more', async () => {
    const at = async (priorRankedWins: number, playerMu: number) => {
      const { client } = fakeClient({ priorRankedWins });
      return checkAndUnlockAchievements(client, ctx(wonGame(false), { isRanked: true, playerMu, rank: 1 }));
    };
    expect(await at(49, 1800)).toContain('ranked_warlord');
    expect(await at(49, 1799)).not.toContain('ranked_warlord');
    expect(await at(48, 1900)).not.toContain('ranked_warlord');
  });

  it('grants Comeback King to a winner who held the fewest territories at some point', async () => {
    const at = async (held: boolean | undefined, rank = 1) =>
      checkAndUnlockAchievements(fakeClient().client, ctx(realWin({ held_fewest_territories: held }), { rank }));
    expect(await at(true)).toContain('comeback_king');
    expect(await at(true, 2)).not.toContain('comeback_king');
    // Never behind on land: no comeback, however the armies stood.
    expect(await at(undefined)).not.toContain('comeback_king');
  });

  it('grants Perfect Defense for a win that lost no territory after turn 3', async () => {
    const at = async (lost: number | undefined, turn = 4) =>
      checkAndUnlockAchievements(fakeClient().client, ctx(realWin({ territories_lost_after_turn_3: lost }, turn)));
    expect(await at(0)).toContain('perfect_defense');
    expect(await at(1)).not.toContain('perfect_defense');
    // A game over by turn 3 has no "after turn 3" to defend.
    expect(await at(0, 3)).not.toContain('perfect_defense');
    // A game that began before losses were counted.
    expect(await at(undefined)).not.toContain('perfect_defense');
  });

  it('grants Underdog Victory for a ranked win over an opponent rated 200+ above you as the game began', async () => {
    const at = async (over: Partial<AchievementContext>) =>
      checkAndUnlockAchievements(fakeClient().client, ctx(wonGame(false), {
        isRanked: true, playerMuBefore: 1500, playerMu: 1560, strongestOpponentMuBefore: 1700, ...over,
      }));
    // The win closes the gap to 140 here; it is the gap before the game that counts.
    expect(await at({})).toContain('underdog');
    expect(await at({ strongestOpponentMuBefore: 1699 })).not.toContain('underdog');
    expect(await at({ isRanked: false })).not.toContain('underdog');
    expect(await at({ rank: 2 })).not.toContain('underdog');
  });

  it('grants Grand Strategist at a ranked rating of 1700, not at the 1500 every player starts on', async () => {
    const at = async (over: Partial<AchievementContext>) =>
      checkAndUnlockAchievements(fakeClient().client, ctx(wonGame(false), { isRanked: true, ...over }));
    expect(await at({ playerMu: 1500 })).not.toContain('strategist');
    expect(await at({ playerMu: 1699 })).not.toContain('strategist');
    expect(await at({ playerMu: 1700 })).toContain('strategist');
    // The rating is reached whether this game was won or lost; a casual game has none.
    expect(await at({ playerMu: 1750, rank: 2 })).toContain('strategist');
    expect(await at({ playerMu: 1800, isRanked: false })).not.toContain('strategist');
  });
});

describe('grantAchievements', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  it('skips an achievement with no definition and still records the rest', async () => {
    // A missing row used to be inserted anyway, and the foreign key violation
    // aborted the transaction holding every player's unlocks from the game.
    const { client, inserted } = fakeClient({ undefinedIds: ['iron_brigade'] });
    const unlocked = await grantAchievements(client, 'me', ['first_blood', 'iron_brigade', 'speed_demon']);
    expect(unlocked).toEqual(['first_blood', 'speed_demon']);
    expect(inserted).toEqual(['first_blood', 'speed_demon']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('iron_brigade'));
  });

  it('does nothing for an empty list', async () => {
    const { client, sql } = fakeClient();
    expect(await grantAchievements(client, 'me', [])).toEqual([]);
    expect(sql).toEqual([]);
  });
});

describe('grantAchievementsOutsideGame', () => {
  it('grants in a transaction of its own', async () => {
    const { client, inserted } = fakeClient();
    transaction.mockImplementationOnce(async (fn: (c: PoolClient) => Promise<unknown>) => fn(client));
    expect(await grantAchievementsOutsideGame('me', ['map_maker'])).toEqual(['map_maker']);
    expect(inserted).toEqual(['map_maker']);
  });

  it('never throws: a failed grant is logged, and the action that earned it carries on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    transaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(grantAchievementsOutsideGame('me', ['map_maker'])).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('map_maker'), expect.any(Error));
    error.mockRestore();
  });
});

/**
 * The tutorial is a lesson, not a game: it unlocks tutorial_complete and
 * nothing else (PT-008). Its guaranteed win used to grant First Blood,
 * Conqueror, Speed Demon and Ancient Master while the profile's stats and
 * the First Victory quest, which skip tutorial games, said no game had been
 * won yet. The fake client answers every count with "none" and records the
 * inserts, which is all these cases need.
 */
import { describe, it, expect } from 'vitest';
import type { PoolClient } from 'pg';
import type { GameState } from '../../types';
import { checkAndUnlockAchievements } from './achievementService';

function fakeClient() {
  const inserted: string[] = [];
  const sql: string[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      sql.push(text);
      if (text.includes('INSERT INTO user_achievements')) {
        inserted.push(String(params[1]));
        return { rowCount: 1, rows: [{ achievement_id: params[1] }] };
      }
      if (text.includes('FROM achievements')) return { rowCount: 1, rows: [{ xp_reward: 0 }] };
      if (text.includes('SELECT xp FROM users')) return { rowCount: 1, rows: [{ xp: 0 }] };
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

const ctx = (gameState: GameState) => ({
  userId: 'me', gameId: 'g1', gameState, winnerId: 'me', rank: 1, totalPlayers: 2,
  gameType: 'solo' as const, isRanked: false, playerMu: 1500, opponentAvgMu: 1100,
});

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
});

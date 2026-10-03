/**
 * What the admin stats leave out, against real Postgres: games played only by
 * admin or test accounts, and those accounts' analytics events. A game with one
 * real player in it still counts, and marking or unmarking an account changes
 * the answer at once.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/services/statsExclusion.db.test.ts
 *
 * Every query is limited to the rows this file seeds, so it is safe beside the
 * other PG_TEST files on a shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { countedEventSql, countedGameSql } from './statsExclusion';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('admin and test accounts out of the stats (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  const users: Record<'admin' | 'tester' | 'player' | 'friend', string> = { admin: '', tester: '', player: '', friend: '' };
  const games: Record<string, string> = {};

  async function seedUser(name: keyof typeof users, flags: { admin?: boolean; test?: boolean } = {}) {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin, exclude_from_stats)
       VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, username, `${username}@test.local`, flags.admin ?? false, flags.test ?? false],
    );
    users[name] = id;
  }

  /** A finished game with these accounts in it, plus one AI seat. */
  async function seedGame(label: string, humans: string[]) {
    const id = uuidv4();
    gameIds.push(id);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, 'era_ancient', 'ancient', 'completed', '{}'::jsonb, 'solo')`,
      [id],
    );
    const seats = [...humans, null];
    for (let i = 0; i < seats.length; i += 1) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
         VALUES ($1, $2, $3, '#ffffff', $4)`,
        [id, seats[i], i, seats[i] === null],
      );
    }
    games[label] = id;
  }

  async function countedGames(): Promise<string[]> {
    const rows = await query(
      `SELECT g.game_id FROM games g WHERE g.game_id = ANY($1) AND ${countedGameSql('g')}`,
      [gameIds],
    );
    const byId = new Map(Object.entries(games).map(([label, id]) => [id, label]));
    return rows.map((r) => byId.get(String(r.game_id))!).sort();
  }

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    await seedUser('admin', { admin: true });
    await seedUser('tester', { test: true });
    await seedUser('player');
    await seedUser('friend');
    await seedGame('admin_alone', [users.admin]);
    await seedGame('tester_alone', [users.tester]);
    await seedGame('admin_and_tester', [users.admin, users.tester]);
    await seedGame('player_alone', [users.player]);
    await seedGame('admin_with_friend', [users.admin, users.friend]);
    await seedGame('bots_only', []);
  });

  afterAll(async () => {
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) {
      await query('DELETE FROM analytics_events WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('counts a game unless everyone who played it is an admin or test account', async () => {
    expect(await countedGames()).toEqual(['admin_with_friend', 'bots_only', 'player_alone']);
  });

  it('reads the marks live: marking a player takes their games out, unmarking puts them back', async () => {
    const mark = (id: string, test: boolean) =>
      query('UPDATE users SET exclude_from_stats = $2 WHERE user_id = $1', [id, test]);
    try {
      await mark(users.player, true);
      expect(await countedGames()).toEqual(['admin_with_friend', 'bots_only']);
      await mark(users.player, false);
      // Unmarked, the tester is a real player, so a game they shared with the admin counts too.
      await mark(users.tester, false);
      expect(await countedGames()).toEqual([
        'admin_and_tester', 'admin_with_friend', 'bots_only', 'player_alone', 'tester_alone',
      ]);
    } finally {
      await mark(users.player, false);
      await mark(users.tester, true);
    }
  });

  it('leaves out their analytics events and keeps anonymous ones', async () => {
    const marker = `stats_exclusion_${uuidv4().slice(0, 8)}`;
    for (const id of [users.admin, users.tester, users.player, null]) {
      await query(
        `INSERT INTO analytics_events (event, user_id, properties) VALUES ('game_finished', $1, $2::jsonb)`,
        [id, JSON.stringify({ marker })],
      );
    }
    const rows = await query(
      `SELECT user_id FROM analytics_events
       WHERE properties->>'marker' = $1 AND ${countedEventSql('analytics_events')}
       ORDER BY user_id NULLS LAST`,
      [marker],
    );
    await query(`DELETE FROM analytics_events WHERE properties->>'marker' = $1`, [marker]);
    expect(rows.map((r) => r.user_id)).toEqual([users.player, null]);
  });
});

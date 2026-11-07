/**
 * Guests on the leaderboards (guest_leaderboards_enabled), against Postgres.
 * Guests earn ratings, XP and streaks like any account; with the switch off the
 * boards leave them out, as they always did, and with it on they are ranked,
 * see their own rank, and their profile opens from a board row.
 *
 * The seeded pair sits at the very top of each board (values no real or test
 * player reaches), so the check is safe beside the other PG_TEST files on a
 * shared database. Redis is replaced by an in-memory map.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/leaderboard/guestLeaderboards.db.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('../../db/redis', () => ({
  redis: {
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => { cache.set(key, value); return 'OK'; },
  },
}));

const enabled = process.env.PG_TEST === '1';
type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
type Entry = { user_id: string };

describe.runIf(enabled)('guests on the leaderboards (Postgres)', { timeout: 30_000 }, () => {
  let query: Query;
  let app: FastifyInstance;
  let setGuestsRanked: (on: boolean) => void;
  let guestAuth: { authorization: string };
  const guestId = uuidv4();
  const accountId = uuidv4();
  const gameIds: string[] = [];

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as { query: Query });
    const adminConfig = await import('../../services/adminConfig');
    setGuestsRanked = (on) => adminConfig.setAdminConfigCacheForTests({ feature_flags: { guest_leaderboards_enabled: on } });
    // The guest edges out the account on every board, so "is the guest there"
    // is never answered by the account crowding it out of the top rows.
    for (const [id, guest, xp, mu, streak] of [
      [guestId, true, 2_000_000_000, 9_000, 99_999],
      [accountId, false, 1_999_999_999, 8_999, 99_998],
    ] as const) {
      const name = `lbg_${id.slice(0, 8)}`;
      await query(
        `INSERT INTO users (user_id, username, email, password_hash, is_guest, xp, level, win_streak, daily_streak)
         VALUES ($1, $2, $3, 'x', $4, $5, 99, $6, 1)`,
        [id, name, `${name}@${guest ? 'guest.local' : 'test.local'}`, guest, xp, streak],
      );
      await query(
        `INSERT INTO user_ratings (user_id, rating_type, mu, phi, last_rated) VALUES ($1, 'solo', $2, 60, NOW())`,
        [id, mu],
      );
    }
    // Wins this week for the Weekly board: three for the guest, two for the account.
    for (const [id, wins] of [[guestId, 3], [accountId, 2]] as const) {
      for (let i = 0; i < wins; i += 1) {
        const gameId = uuidv4();
        gameIds.push(gameId);
        await query(
          `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, ended_at)
           VALUES ($1, 'community_britain_925', 'medieval', 'completed', '{"max_players": 2}'::jsonb, 'solo', NOW())`,
          [gameId],
        );
        await query(
          `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, final_rank)
           VALUES ($1, $2, 0, '#e74c3c', false, 1)`,
          [gameId, id],
        );
      }
    }
    const { signAccessToken } = await import('../../utils/jwt');
    guestAuth = { authorization: `Bearer ${signAccessToken({ sub: guestId, username: 'lbg', guest: true, admin: false })}` };
    const { leaderboardRoutes } = await import('./leaderboard.routes');
    const { usersRoutes } = await import('../users/users.routes');
    app = Fastify();
    await app.register(leaderboardRoutes, { prefix: '/api/leaderboards' });
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (query) {
      await query('DELETE FROM game_players WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
      await query('DELETE FROM user_ratings WHERE user_id = ANY($1)', [[guestId, accountId]]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [[guestId, accountId]]).catch(() => {});
    }
  });

  beforeEach(() => cache.clear());

  const get = (url: string) => app.inject({ method: 'GET', url, headers: guestAuth });
  const ids = async (url: string) => ((await get(url)).json().entries as Entry[]).map((e) => e.user_id);

  it('leaves guests off every board while the switch is off', async () => {
    setGuestsRanked(false);
    for (const url of ['/api/leaderboards/rating?type=solo&limit=5', '/api/leaderboards/level?limit=5', '/api/leaderboards/streaks?limit=5']) {
      const board = await ids(url);
      expect(board[0]).toBe(accountId);
      expect(board).not.toContain(guestId);
    }
    expect(await ids('/api/leaderboards/weekly?limit=100')).toContain(accountId);
    expect(await ids('/api/leaderboards/weekly?limit=100')).not.toContain(guestId);
    const mine = (await get('/api/leaderboards/my-rank')).json();
    expect(mine.level).toBeNull();
    expect(mine.streak).toBeNull();
    expect((await get(`/api/users/${guestId}`)).statusCode).toBe(404);
    expect((await get('/api/users/me')).json().ratings).toEqual({});
  });

  it('ranks guests like any account with the switch on, and opens their profile', async () => {
    setGuestsRanked(false);
    await ids('/api/leaderboards/level?limit=5'); // cached without the guest
    setGuestsRanked(true);
    // The cached board without guests is not served once they count.
    for (const url of ['/api/leaderboards/rating?type=solo&limit=5', '/api/leaderboards/level?limit=5', '/api/leaderboards/streaks?limit=5']) {
      const board = await ids(url);
      expect(board.slice(0, 2)).toEqual([guestId, accountId]);
    }
    const weekly = await ids('/api/leaderboards/weekly?limit=100');
    expect(weekly.indexOf(guestId)).toBeGreaterThanOrEqual(0);
    expect(weekly.indexOf(guestId)).toBeLessThan(weekly.indexOf(accountId));
    const mine = (await get('/api/leaderboards/my-rank')).json();
    expect(mine.level).toMatchObject({ rank: 1 });
    expect(mine.streak).toMatchObject({ rank: 1, win_streak: 99_999 });

    const profile = await get(`/api/users/${guestId}`);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ user_id: guestId, ratings: { solo: expect.anything() } });
    expect((await get('/api/users/me')).json().ratings).toHaveProperty('solo');
  });
});

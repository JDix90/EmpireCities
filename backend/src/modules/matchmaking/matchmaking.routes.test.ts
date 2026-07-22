/**
 * Integration coverage for ranked matchmaking join.
 *
 * Regression target: attemptMatch()'s candidate SELECT LEFT JOINs
 * ranked_placement_progress and applied a bare `FOR UPDATE SKIP LOCKED`.
 * Postgres rejects locking the nullable side of an outer join
 * ("FOR UPDATE cannot be applied to the nullable side of an outer join",
 * SQLSTATE 0A000), and because attemptMatch runs on EVERY /join before the
 * candidate-count check, every ranked queue attempt 500'd — the "Internal
 * server error" players saw the moment they picked any ranked bucket. The fix
 * scopes the lock to the queue rows: `FOR UPDATE OF q SKIP LOCKED`.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=/tmp POSTGRES_PORT=5499 POSTGRES_USER=$USER \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/matchmaking/matchmaking.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('ranked matchmaking join (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];

  async function seedUser(name: string): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, level, xp)
       VALUES ($1, $2, $3, 'x', 5, 3000)`,
      [id, name, `${name}-${id}@test.local`],
    );
    return id;
  }

  function join(userId: string, username: string, era: string, bucket: string) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({
      method: 'POST',
      url: '/api/matchmaking/join',
      headers: { authorization: `Bearer ${token}` },
      payload: { era_id: era, bucket },
    });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { matchmakingRoutes } = await import('./matchmaking.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(matchmakingRoutes, { prefix: '/api/matchmaking' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (userIds.length) {
      // FK cascades clean ranked_queue / ranked_placement_progress / game_players.
      await query(`DELETE FROM games WHERE game_id IN (
        SELECT game_id FROM game_players WHERE user_id = ANY($1)
      )`, [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('a solo join returns 200 (regression: FOR UPDATE on outer join no longer 500s)', async () => {
    const id = await seedUser('mm_solo');
    for (const bucket of ['blitz_120', 'standard_300', 'async_43200']) {
      const res = await join(id, 'mm_solo', 'ancient', bucket);
      expect(res.statusCode, `bucket ${bucket}`).toBe(200);
      expect(res.json()).toMatchObject({ queued: true });
    }
  });

  it('two players in the same bucket are paired into a ranked game', async () => {
    const a = await seedUser('mm_a');
    const b = await seedUser('mm_b');
    expect((await join(a, 'mm_a', 'medieval', 'blitz_120')).statusCode).toBe(200);
    expect((await join(b, 'mm_b', 'medieval', 'blitz_120')).statusCode).toBe(200);

    const games = await query(
      `SELECT g.game_id FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.is_ranked = true AND g.queue_bucket = 'blitz_120' AND gp.user_id = ANY($1)`,
      [[a, b]],
    );
    expect(games.length).toBeGreaterThan(0);
    // Both players dequeued after pairing.
    const stillQueued = await query('SELECT user_id FROM ranked_queue WHERE user_id = ANY($1)', [[a, b]]);
    expect(stillQueued.length).toBe(0);
  });

  it('rejects an era ranked does not support with 400, not 500', async () => {
    const id = await seedUser('mm_era');
    const res = await join(id, 'mm_era', 'space_age', 'blitz_120');
    expect(res.statusCode).toBe(400);
  });

  it('flag OFF: preferred_opponents is accepted but coerced — two P=3 users still pair as 1v1', async () => {
    const a = await seedUser('mm_off_a');
    const b = await seedUser('mm_off_b');
    expect((await join(a, 'mm_off_a', 'coldwar', 'blitz_120', 3)).statusCode).toBe(200);
    expect((await join(b, 'mm_off_b', 'coldwar', 'blitz_120', 3)).statusCode).toBe(200);
    const games = await query<{ game_id: string; settings_json: { max_players: number } }>(
      `SELECT g.game_id, g.settings_json FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.is_ranked = true AND gp.user_id = $1`,
      [a],
    );
    expect(games.length).toBe(1);
    expect(games[0].settings_json.max_players).toBe(2);
  });
});

/**
 * Multi-size ranked matchmaking (flag `ranked_multi_size_enabled` ON via the
 * admin-config override): cohort matching, join-time smaller-game offers, and
 * the accept-offer endpoint. Same PG gating and env invocation as above.
 */
describe.runIf(enabled)('multi-size ranked matchmaking (Postgres, flag on)', () => {
  let app: FastifyInstance;
  let query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  let resetAdminConfigCacheForTests: () => void;
  const userIds: string[] = [];

  async function seedUser(name: string, mu?: number): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, level, xp)
       VALUES ($1, $2, $3, 'x', 5, 3000)`,
      [id, name, `${name}-${id}@test.local`],
    );
    if (mu !== undefined) {
      await query(
        `INSERT INTO user_ratings (user_id, rating_type, mu, phi, last_rated)
         VALUES ($1, 'ranked', $2, 60, NOW())`,
        [id, mu],
      );
    }
    return id;
  }

  function join(userId: string, username: string, era: string, bucket: string, preferred?: number) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({
      method: 'POST',
      url: '/api/matchmaking/join',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        era_id: era,
        bucket,
        ...(preferred !== undefined ? { preferred_opponents: preferred } : {}),
      },
    });
  }

  function acceptOffer(userId: string, username: string, opponents: number) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({
      method: 'POST',
      url: '/api/matchmaking/accept-offer',
      headers: { authorization: `Bearer ${token}` },
      payload: { opponents },
    });
  }

  async function rankedGamesOf(userId: string) {
    return query<{ game_id: string; settings_json: { max_players: number } }>(
      `SELECT g.game_id, g.settings_json FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id
       WHERE g.is_ranked = true AND gp.user_id = $1`,
      [userId],
    );
  }

  beforeAll(async () => {
    const adminConfig = await import('../../services/adminConfig');
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { ranked_multi_size_enabled: true } });
    resetAdminConfigCacheForTests = adminConfig.resetAdminConfigCacheForTests;

    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { matchmakingRoutes } = await import('./matchmaking.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(matchmakingRoutes, { prefix: '/api/matchmaking' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    resetAdminConfigCacheForTests?.();
    if (app) await app.close();
    if (userIds.length) {
      await query(`DELETE FROM games WHERE game_id IN (
        SELECT game_id FROM game_players WHERE user_id = ANY($1)
      )`, [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('three P=2 joins form one 3-player game with sequential seats and distinct colors', async () => {
    const a = await seedUser('ms_a');
    const b = await seedUser('ms_b');
    const c = await seedUser('ms_c');
    expect((await join(a, 'ms_a', 'ancient', 'blitz_120', 2)).statusCode).toBe(200);
    expect((await join(b, 'ms_b', 'ancient', 'blitz_120', 2)).statusCode).toBe(200);
    // Two queued at P=2 → no game yet.
    expect((await rankedGamesOf(a)).length).toBe(0);

    // Requirement 3: the third P=2 player completes the cohort silently.
    const third = await join(c, 'ms_c', 'ancient', 'blitz_120', 2);
    expect(third.statusCode).toBe(200);
    expect(third.json().offer).toBeUndefined();

    const games = await rankedGamesOf(a);
    expect(games.length).toBe(1);
    expect(games[0].settings_json.max_players).toBe(3);
    const seats = await query<{ player_index: number; player_color: string }>(
      'SELECT player_index, player_color FROM game_players WHERE game_id = $1 ORDER BY player_index',
      [games[0].game_id],
    );
    expect(seats.map((s) => s.player_index)).toEqual([0, 1, 2]);
    expect(new Set(seats.map((s) => s.player_color)).size).toBe(3);
    const stillQueued = await query('SELECT 1 FROM ranked_queue WHERE user_id = ANY($1)', [[a, b, c]]);
    expect(stillQueued.length).toBe(0);
  });

  it('a larger-preference join gets an offer for the largest one-short smaller cohort', async () => {
    // One-short cohorts at Q=1 (1 user) and Q=2 (2 users); P=4 joiner should be
    // offered Q=2 (largest, closest to their preference).
    const q1 = await seedUser('ms_q1');
    const q2a = await seedUser('ms_q2a');
    const q2b = await seedUser('ms_q2b');
    const d = await seedUser('ms_d');
    expect((await join(q1, 'ms_q1', 'medieval', 'standard_300', 1)).statusCode).toBe(200);
    expect((await join(q2a, 'ms_q2a', 'medieval', 'standard_300', 2)).statusCode).toBe(200);
    expect((await join(q2b, 'ms_q2b', 'medieval', 'standard_300', 2)).statusCode).toBe(200);

    const res = await join(d, 'ms_d', 'medieval', 'standard_300', 4);
    expect(res.statusCode).toBe(200);
    expect(res.json().offer).toMatchObject({ opponents: 2, era_id: 'medieval', bucket: 'standard_300' });
    // D stays queued at their own preference.
    const row = await query<{ preferred_opponents: number }>(
      'SELECT preferred_opponents FROM ranked_queue WHERE user_id = $1',
      [d],
    );
    expect(row[0]?.preferred_opponents).toBe(4);

    // accept-offer completes the 3-player game and drains those queue rows.
    const accepted = await acceptOffer(d, 'ms_d', 2);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().formed).toBe(true);
    const games = await rankedGamesOf(d);
    expect(games.length).toBe(1);
    expect(games[0].settings_json.max_players).toBe(3);
    const remaining = await query('SELECT 1 FROM ranked_queue WHERE user_id = ANY($1)', [[q2a, q2b, d]]);
    expect(remaining.length).toBe(0);
    // The untouched Q=1 user is still waiting.
    const q1Row = await query('SELECT 1 FROM ranked_queue WHERE user_id = $1', [q1]);
    expect(q1Row.length).toBe(1);
  });

  it('accept-offer reports cohort_gone when the smaller cohort no longer exists', async () => {
    const e = await seedUser('ms_e');
    expect((await join(e, 'ms_e', 'ww2', 'long_1200', 5)).statusCode).toBe(200);
    const res = await acceptOffer(e, 'ms_e', 2);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ formed: false, reason: 'cohort_gone' });
    // Caller keeps their original queue row.
    const row = await query<{ preferred_opponents: number }>(
      'SELECT preferred_opponents FROM ranked_queue WHERE user_id = $1',
      [e],
    );
    expect(row[0]?.preferred_opponents).toBe(5);
  });

  it('accept-offer reports not_queued for a player no longer in the queue', async () => {
    const f = await seedUser('ms_f');
    const res = await acceptOffer(f, 'ms_f', 2);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ formed: false, reason: 'not_queued' });
  });

  it('no offer when the smaller cohort is mu-incompatible with the joiner', async () => {
    const low = await seedUser('ms_low', 1200);
    const high = await seedUser('ms_high', 2400);
    expect((await join(low, 'ms_low', 'modern', 'blitz_120', 1)).statusCode).toBe(200);
    const res = await join(high, 'ms_high', 'modern', 'blitz_120', 3);
    expect(res.statusCode).toBe(200);
    expect(res.json().offer).toBeUndefined();
    // And they weren't force-matched either (mu gap blocks the 1v1 cohort too).
    expect((await rankedGamesOf(high)).length).toBe(0);
  });

  it('era cap clamps the preference (risorgimento P=5 → max 2) and /status reports it', async () => {
    const g = await seedUser('ms_g');
    expect((await join(g, 'ms_g', 'risorgimento', 'async_86400', 5)).statusCode).toBe(200);
    const token = signAccessToken({ sub: g, username: 'ms_g', guest: false });
    const status = await app.inject({
      method: 'GET',
      url: '/api/matchmaking/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ queued: true, preferred_opponents: 2 });
  });
});

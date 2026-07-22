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
});

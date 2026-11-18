/**
 * The first match and the first-win ladder leave campaign stages out.
 *
 * A campaign stage is a finished solo game like any other, so winning one
 * counted as the player's first win: the lobby stopped offering the first
 * match to someone who had never played it, and the server dropped its tag.
 * GET /users/me/stats now sends `ladder`, the same counts without campaign
 * stages, beside `overall`, which still has them; and the server's own check
 * (firstMatchEligibility.ts) leaves them out the same way.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1, as
 * tutorialNotCounted.routes.test.ts is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

interface StatsBody {
  overall: { played: number; won: number };
  ladder: { played: number; won: number };
}

describe.runIf(enabled)('campaign stages are off the ladder (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let headers: { authorization: string };
  let eligibility: typeof import('../games/firstMatchEligibility');
  const userId = uuidv4();
  const gameIds: string[] = [];

  async function seedCompletedGame(settings: Record<string, unknown>, won: boolean): Promise<void> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, ended_at)
       VALUES ($1, 'era_ancient', 'ancient', 'completed', $2::jsonb, 'solo', NOW())`,
      [gameId, JSON.stringify(settings)],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, final_rank)
       VALUES ($1, $2, 0, '#3498db', false, $3)`,
      [gameId, userId, won ? 1 : 2],
    );
  }

  const stats = async () => (await app.inject({ method: 'GET', url: '/api/users/me/stats', headers })).json() as StatsBody;

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    eligibility = await import('../games/firstMatchEligibility');
    const name = `ladder_${userId.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [userId, name, `${name}@test.local`],
    );
    const { signAccessToken } = await import('../../utils/jwt');
    headers = { authorization: `Bearer ${signAccessToken({ sub: userId, username: name, guest: false })}` };
    const { registerErrorHandler } = await import('../../errorHandler');
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    for (const id of gameIds) await query('DELETE FROM games WHERE game_id = $1', [id]).catch(() => {});
    await query('DELETE FROM users WHERE user_id = $1', [userId]).catch(() => {});
  });

  it('a campaign stage won is on the record and not on the ladder', async () => {
    await seedCompletedGame({ is_campaign: true, max_players: 4 }, true);
    const s = await stats();
    expect(s.overall).toMatchObject({ played: 1, won: 1 });
    expect(s.ladder).toMatchObject({ played: 0, won: 0 });
    expect(await eligibility.hasFinishedRealGame(userId)).toBe(false);
    expect(await eligibility.hasWonRealGame(userId)).toBe(false);
  });

  it('an ordinary game counts on both', async () => {
    await seedCompletedGame({ max_players: 2 }, false);
    let s = await stats();
    expect(s.overall).toMatchObject({ played: 2, won: 1 });
    expect(s.ladder).toMatchObject({ played: 1, won: 0 });
    expect(await eligibility.hasFinishedRealGame(userId)).toBe(true);
    expect(await eligibility.hasWonRealGame(userId)).toBe(false);

    await seedCompletedGame({ max_players: 2 }, true);
    s = await stats();
    expect(s.ladder).toMatchObject({ played: 2, won: 1 });
    expect(await eligibility.hasWonRealGame(userId)).toBe(true);
  });
});

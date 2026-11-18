/**
 * A tutorial the player skips or ends early counts as a completed game on the
 * admin dashboard (game-engine/tutorial/tutorialGames.ts, completedGameSql).
 *
 * Every way out of the tutorial calls DELETE /api/games/:gameId/abandon,
 * which stamps the tutorial `tutorial_exited`. The overview's "Completed"
 * counts it; a tutorial the stale-game sweep abandoned (a closed tab) and an
 * abandoned real game stay out. The game itself stays `abandoned`.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/admin/tutorialExitCompleted.db.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

interface OverviewBody {
  games_created: number;
  games_completed: number;
  tutorials_exited: number;
  games_by_status: Record<string, number>;
}

describe.runIf(enabled)('an exited tutorial counts as completed (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  // A day of its own, decades back, so the overview's created-date filter
  // sees only this test's games on a shared database.
  const DAY = new Date(Date.UTC(1980 + Math.floor(Math.random() * 15), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)))
    .toISOString()
    .slice(0, 10);

  async function seedUser(base: string, admin = false): Promise<{ id: string; name: string; admin: boolean }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_admin)
       VALUES ($1, $2, $3, 'x', $4)`,
      [id, name, `${name}@test.local`, admin],
    );
    return { id, name, admin };
  }

  async function seedGame(playerId: string, opts: { tutorial: boolean; status: 'in_progress' | 'completed' | 'abandoned' }): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    const settings = opts.tutorial ? { tutorial: true, tutorial_lesson_module: 'core', max_players: 2 } : { max_players: 2 };
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, created_at, started_at, ended_at)
       VALUES ($1, 'tutorial', 'ww2', $2, $3::jsonb, 'solo', $4::date + TIME '12:00', $4::date + TIME '12:00',
               CASE WHEN $5::boolean THEN NULL ELSE $4::date + TIME '12:30' END)`,
      [gameId, opts.status, JSON.stringify(settings), DAY, opts.status === 'in_progress'],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, playerId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
       VALUES ($1, NULL, 1, '#3498db', true, 'tutorial')`,
      [gameId],
    );
    return gameId;
  }

  function auth(user: { id: string; name: string; admin: boolean }) {
    return { authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: false, admin: user.admin })}` };
  }

  async function settingsOf(gameId: string): Promise<{ status: string; settings: Record<string, unknown> }> {
    const [row] = await query('SELECT status, settings_json FROM games WHERE game_id = $1', [gameId]);
    return { status: String(row.status), settings: row.settings_json as Record<string, unknown> };
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { gamesRoutes } = await import('../games/games.routes');
    const { adminRoutes } = await import('./admin.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(gamesRoutes, { prefix: '/api/games' });
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('stamps a tutorial the player leaves, leaves a real game alone, and the overview counts the tutorial as completed', async () => {
    const player = await seedUser('tut_exit');
    const admin = await seedUser('tut_exit_admin', true);

    const exited = await seedGame(player.id, { tutorial: true, status: 'in_progress' });
    const quit = await seedGame(player.id, { tutorial: false, status: 'in_progress' });
    // Closed tab: the stale-game sweep abandoned it, unstamped.
    await seedGame(player.id, { tutorial: true, status: 'abandoned' });
    await seedGame(player.id, { tutorial: false, status: 'completed' });

    for (const gameId of [exited, quit]) {
      const res = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}/abandon`, headers: auth(player) });
      expect(res.statusCode, res.body).toBe(200);
    }

    const tutorial = await settingsOf(exited);
    expect(tutorial.status).toBe('abandoned');
    expect(tutorial.settings).toMatchObject({ tutorial: true, tutorial_lesson_module: 'core', tutorial_exited: true });

    const real = await settingsOf(quit);
    expect(real.status).toBe('abandoned');
    expect(real.settings).toEqual({ max_players: 2 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/metrics/overview?from=${DAY}T00:00:00Z&to=${DAY}T23:59:59Z`,
      headers: auth(admin),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as OverviewBody;
    expect(body.games_created).toBe(4);
    expect(body.games_completed).toBe(2);
    expect(body.tutorials_exited).toBe(1);
    expect(body.games_by_status).toEqual({ completed: 2, abandoned: 2 });
  });
});

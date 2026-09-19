/**
 * The tutorial is a lesson, not a match on your record.
 *
 * Reported from testing: the tutorial was counting towards each user's "games
 * played". It does reach `status = 'completed'` like any other game —
 * `finalizeGame` does not special-case it — so every query that counts a
 * user's completed games was counting their tutorial too: the Profile page's
 * "Games Played" and win rate, the Veteran achievement's progress bar, the
 * leaderboards' games/wins columns, and the referral reward's game threshold.
 *
 * Worse than a cosmetic +1: the tutorial bot never attacks (`aiBot.ts`), so a
 * completed tutorial is a guaranteed win. It inflated win rate and win streak,
 * and it could complete a referral reward on its own.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/users/tutorialNotCounted.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

interface StatsBody {
  overall: { played: number; won: number; win_rate: number };
  solo: { played: number; won: number; win_rate: number };
  by_era: Record<string, { played: number; won: number }>;
  streaks: { current_win: number; best_win: number };
}

describe.runIf(enabled)('the tutorial does not count as a game played (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  async function seedUser(base: string): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [id, name, `${name}@test.local`],
    );
    return { id, name };
  }

  /** A finished game with `userId` seated, won or lost, tutorial or not. */
  async function seedCompletedGame(opts: {
    userId: string;
    tutorial: boolean;
    won: boolean;
    eraId?: string;
  }): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    const settings = opts.tutorial
      ? { tutorial: true, tutorial_lesson_module: 'core', max_players: 2 }
      : { max_players: 2 };
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, ended_at)
       VALUES ($1, 'era_ancient', $2, 'completed', $3::jsonb, 'solo', NOW())`,
      [gameId, opts.eraId ?? 'ancient', JSON.stringify(settings)],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, final_rank)
       VALUES ($1, $2, 0, '#e74c3c', false, $3)`,
      [gameId, opts.userId, opts.won ? 1 : 2],
    );
    return gameId;
  }

  function get(url: string, userId: string, username: string) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) {
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('GET /users/me/stats counts the real game and not the tutorial', async () => {
    const u = await seedUser('tut_stats');
    await seedCompletedGame({ userId: u.id, tutorial: true, won: true });
    await seedCompletedGame({ userId: u.id, tutorial: false, won: false });

    const body = (await get('/api/users/me/stats', u.id, u.name)).json() as StatsBody;
    expect(body.overall.played).toBe(1);
    expect(body.overall.won).toBe(0);
    // The tutorial is a guaranteed win, so counting it read as a 50% win rate
    // for a player who has never won a real game.
    expect(body.overall.win_rate).toBe(0);
    expect(body.solo.played).toBe(1);
  });

  it('a tutorial win does not pad the win streak', async () => {
    const u = await seedUser('tut_streak');
    await seedCompletedGame({ userId: u.id, tutorial: true, won: true });

    const body = (await get('/api/users/me/stats', u.id, u.name)).json() as StatsBody;
    expect(body.streaks.current_win).toBe(0);
    expect(body.streaks.best_win).toBe(0);
  });

  it('the tutorial is absent from the per-era breakdown too', async () => {
    const u = await seedUser('tut_era');
    await seedCompletedGame({ userId: u.id, tutorial: true, won: true, eraId: 'medieval' });

    const body = (await get('/api/users/me/stats', u.id, u.name)).json() as StatsBody;
    expect(body.by_era.medieval).toBeUndefined();
  });

  it('Veteran achievement progress ignores the tutorial', async () => {
    const u = await seedUser('tut_vet');
    await seedCompletedGame({ userId: u.id, tutorial: true, won: true });
    await seedCompletedGame({ userId: u.id, tutorial: false, won: true });

    const body = (await get('/api/users/me/achievements/progress', u.id, u.name)).json() as {
      veteran: { current: number; target: number };
    };
    expect(body.veteran.current).toBe(1);
  });

  it('a real game still counts — the filter is not a blanket zero', async () => {
    const u = await seedUser('tut_real');
    await seedCompletedGame({ userId: u.id, tutorial: false, won: true });
    await seedCompletedGame({ userId: u.id, tutorial: false, won: true });

    const body = (await get('/api/users/me/stats', u.id, u.name)).json() as StatsBody;
    expect(body.overall.played).toBe(2);
    expect(body.overall.won).toBe(2);
    expect(body.streaks.current_win).toBe(2);
  });
});

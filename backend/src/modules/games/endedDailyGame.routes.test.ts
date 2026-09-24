/**
 * A finished daily game tells the ended screen whether its run was won.
 *
 * `/game/:id` for a finished game names the winner from `games.winner_id`.
 * On a daily objective day that is the wrong source: taking every rival
 * before the goal is met leaves the player as the game's winner and the
 * run lost, so the page said "You won this one." over a challenge the Daily
 * page records as a defeat. `GET /api/games/:gameId` (and the socket join
 * snapshot) now carry `daily_won`, read from the player's daily entry.
 *
 * The entry is found by player and day, comparing both dates as `::date`
 * because the game's setting holds a JSON-stringified timestamp. The seeds
 * below store it in exactly that form.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/endedDailyGame.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('a finished daily game carries its run result (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  let dailyRunWonForGame: (gameId: string) => Promise<boolean | null>;
  const userIds: string[] = [];
  const gameIds: string[] = [];
  const DAY = '2001-02-03';
  // What the start route stores: the challenge row's pg Date, JSON-stringified.
  const STORED_DAY = '2001-02-03T06:00:00.000Z';

  async function seedUser(base: string): Promise<{ id: string; name: string }> {
    const id = uuidv4();
    const name = `${base}_${id.slice(0, 8)}`;
    userIds.push(id);
    await query(
      `INSERT INTO users (user_id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
      [id, name, `${name}@test.local`],
    );
    return { id, name };
  }

  /** A finished two-seat game: the human at seat 0, a bot at seat 1. */
  async function seedFinishedGame(opts: {
    humanId: string;
    winnerId: string | null;
    daily: boolean;
    status?: 'completed' | 'abandoned';
  }): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    const settings = opts.daily
      ? { daily_challenge_date: STORED_DAY, daily_challenge_spec: { archetype: 'tech_research' }, max_players: 2 }
      : { max_players: 2 };
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, winner_id, ended_at)
       VALUES ($1, 'era_discovery', 'discovery', $2, $3::jsonb, 'solo', $4, NOW())`,
      [gameId, opts.status ?? 'completed', JSON.stringify(settings), opts.winnerId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, opts.humanId],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty, is_eliminated)
       VALUES ($1, NULL, 1, '#3498db', true, 'medium', true)`,
      [gameId],
    );
    return gameId;
  }

  async function seedEntry(userId: string, won: boolean): Promise<void> {
    await query(
      `INSERT INTO daily_challenge_entries (challenge_date, user_id, won, turn_count, territory_count, puzzle_score)
       VALUES ($1::date, $2, $3, 1, 3, 1000)`,
      [DAY, userId, won],
    );
  }

  function getGame(gameId: string, user: { id: string; name: string }) {
    const token = signAccessToken({ sub: user.id, username: user.name, guest: false });
    return app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    ({ dailyRunWonForGame } = await import('../../game-engine/daily/dailyRunResult'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { gamesRoutes } = await import('./games.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(gamesRoutes, { prefix: '/api/games' });
    await app.ready();
    await query(
      `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count, kind, spec_json)
       VALUES ($1, 'discovery', 'era_discovery', 1, 2, 'puzzle', '{"archetype":"tech_research"}'::jsonb)
       ON CONFLICT (challenge_date) DO NOTHING`,
      [DAY],
    );
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) {
      await query('DELETE FROM daily_challenge_entries WHERE user_id = ANY($1)', [userIds]).catch(() => {});
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
    await query('DELETE FROM daily_challenges WHERE challenge_date = $1::date', [DAY]).catch(() => {});
  });

  it('reports a lost run on a board its player won', async () => {
    // The reported day: every rival gone on turn 1, the tech not researched.
    const player = await seedUser('ended_lost');
    const gameId = await seedFinishedGame({ humanId: player.id, winnerId: player.id, daily: true });
    await seedEntry(player.id, false);

    expect(await dailyRunWonForGame(gameId)).toBe(false);
    const res = await getGame(gameId, player);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { winner_id: string | null; daily_won: boolean | null };
    expect(body.winner_id).toBe(player.id);
    expect(body.daily_won).toBe(false);
  });

  it('reports a won run as won', async () => {
    const player = await seedUser('ended_won');
    const gameId = await seedFinishedGame({ humanId: player.id, winnerId: player.id, daily: true });
    await seedEntry(player.id, true);

    expect(await dailyRunWonForGame(gameId)).toBe(true);
    expect((await getGame(gameId, player)).json()).toMatchObject({ daily_won: true });
  });

  it('says nothing about a run for any other game, or before the run has an entry', async () => {
    const player = await seedUser('ended_other');
    const ordinary = await seedFinishedGame({ humanId: player.id, winnerId: player.id, daily: false });
    expect(await dailyRunWonForGame(ordinary)).toBeNull();
    expect((await getGame(ordinary, player)).json()).toMatchObject({ daily_won: null });

    const noEntry = await seedFinishedGame({ humanId: player.id, winnerId: player.id, daily: true });
    expect(await dailyRunWonForGame(noEntry)).toBeNull();
  });

  it('reads the run from the player, whoever is looking', async () => {
    // Another signed-in user opening the game sees the player's run result,
    // not their own entry for the same day.
    const player = await seedUser('ended_owner');
    const viewer = await seedUser('ended_viewer');
    const gameId = await seedFinishedGame({ humanId: player.id, winnerId: player.id, daily: true });
    await seedEntry(player.id, false);
    await seedEntry(viewer.id, true);

    expect((await getGame(gameId, viewer)).json()).toMatchObject({ daily_won: false });
  });

  it('only reads a played-out game: an abandoned daily has no result line', async () => {
    const player = await seedUser('ended_abandoned');
    const gameId = await seedFinishedGame({ humanId: player.id, winnerId: null, daily: true, status: 'abandoned' });
    await seedEntry(player.id, false);

    expect((await getGame(gameId, player)).json()).toMatchObject({ daily_won: null });
  });
});

/**
 * No route hands a client the secrets of a live daily.
 *
 * A daily game stores the day's whole spec: in `games.settings_json` and in
 * every `game_states` snapshot's `settings`. On a v2 day that spec holds the
 * answer key (`v2.solution`, the best line and every graded decision), and on
 * every day the dice seeds that generate the stream every player shares.
 * Each snapshot also carries that stream itself (`puzzle_dice_queue`), every
 * roll of the day in order. The live socket and `/api/daily/today` withhold
 * the spec's secrets. These three routes did not, and all three are reachable
 * while the day is still live:
 *
 *  - `GET /api/games/:gameId`, one request from any signed-in user;
 *  - `GET /api/games/:gameId/replay`, open to a participant once the game is
 *    finished or abandoned. Abandoning in the first two turns records no daily
 *    entry, so a player could read the key and start the day again;
 *  - `GET /api/share/:gameId/public-replay`, needing no sign-in at all once
 *    the player shares their result.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/dailySecrets.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

/** Strings that must never appear in any payload these routes return. */
const SECRETS = ['"solution"', '"dice_queue_seed"', 'top-secret-seed', '"puzzle_dice_queue"', '"mission_seed_salt"'];

describe.runIf(enabled)("a live daily's secrets stay on the server (Postgres)", () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean }) => string;
  const userIds: string[] = [];
  const gameIds: string[] = [];

  const spec = {
    archetype: 'military_capture',
    title: 'Cut the Supply Line',
    goal: 'Take Gaul and hold it.',
    dice_queue_seed: 424242,
    v2: {
      version: 2,
      theme: 'cut the supply line',
      plan: { steps: [{ kind: 'draft', to: 'gaul', when: 'objective_ai' }] },
      plan_prose: ['While it holds the objective, it reinforces Gaul.'],
      decisions_target: 2,
      verdicts: 'before_dice',
      intent: 'arrows',
      solution: {
        equity: 0.71,
        obvious_equity: 0.42,
        decisions: [{ turn: 1, best: { kind: 'attack', from: 'italia', to: 'gaul' } }],
        line: [{ action: { kind: 'attack', from: 'italia', to: 'gaul' } }],
      },
    },
  };
  const settings = { max_players: 2, seed: 'top-secret-seed', daily_challenge_date: '2001-03-04T06:00:00.000Z', daily_challenge_spec: spec };

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

  /** A v2 daily game with the player at seat 0 and two stored snapshots. */
  async function seedDailyGame(playerId: string, status: 'completed' | 'abandoned', isPublic = false): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_replay_public, ended_at)
       VALUES ($1, 'era_ancient', 'ancient', $2, $3::jsonb, 'solo', $4, NOW())`,
      [gameId, status, JSON.stringify(settings), isPublic],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false), ($1, NULL, 1, '#3498db', true)`,
      [gameId, playerId],
    );
    for (const turn of [1, 2]) {
      const state = {
        game_id: gameId,
        phase: turn === 2 && status === 'completed' ? 'game_over' : 'attack',
        turn_number: turn,
        map_id: 'era_ancient',
        players: [
          { player_id: playerId, is_ai: false, is_eliminated: false, territory_count: 1, cards: [], secret_mission: null },
          { player_id: 'ai_1', is_ai: true, is_eliminated: false, territory_count: 1, cards: [], secret_mission: null },
        ],
        territories: {},
        card_deck: [],
        mission_seed_salt: 'salt',
        // The day's dice stream: the same for every player of the day.
        puzzle_dice_queue: [6, 5, 4, 3, 2, 1],
        settings,
      };
      await query(
        `INSERT INTO game_states (game_id, turn_number, state_json) VALUES ($1, $2, $3::jsonb)`,
        [gameId, turn, JSON.stringify(state)],
      );
    }
    return gameId;
  }

  function get(url: string, user?: { id: string; name: string }) {
    const headers = user
      ? { authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: false })}` }
      : {};
    return app.inject({ method: 'GET', url, headers });
  }

  function expectNoSecrets(body: string): void {
    for (const secret of SECRETS) expect(body, `payload carries ${secret}`).not.toContain(secret);
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { gamesRoutes } = await import('./games.routes');
    const { shareRoutes } = await import('../share/share.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(gamesRoutes, { prefix: '/api/games' });
    await app.register(shareRoutes, { prefix: '/api/share' });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    if (userIds.length) await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
  });

  it('GET /api/games/:gameId gives any signed-in user the public reading only', async () => {
    const player = await seedUser('secrets_player');
    const stranger = await seedUser('secrets_stranger');
    const gameId = await seedDailyGame(player.id, 'completed');

    for (const viewer of [player, stranger]) {
      const res = await get(`/api/games/${gameId}`, viewer);
      expect(res.statusCode).toBe(200);
      expectNoSecrets(res.body);
      // What the day shows its player stays: the theme and the plan in words.
      expect(res.body).toContain('cut the supply line');
      expect(res.body).toContain('While it holds the objective');
    }
  });

  it("a replay of a daily abandoned inside the grace window hands over none of the day's secrets", async () => {
    // The restart path: abandon on turn 1-2 (no entry is recorded), read the
    // replay, start the day again.
    const player = await seedUser('secrets_abandon');
    const gameId = await seedDailyGame(player.id, 'abandoned');

    const res = await get(`/api/games/${gameId}/replay`, player);
    expect(res.statusCode).toBe(200);
    const { snapshots } = res.json() as { snapshots: Array<{ state: Record<string, unknown> }> };
    expect(snapshots).toHaveLength(2);
    expectNoSecrets(res.body);
    // Still a replay: the snapshots keep the board and the public spec.
    expect(res.body).toContain('cut the supply line');
  });

  it("a shared replay, which needs no sign-in, publishes none of the day's secrets", async () => {
    const player = await seedUser('secrets_share');
    const gameId = await seedDailyGame(player.id, 'completed', true);

    const res = await get(`/api/share/${gameId}/public-replay`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { snapshots: unknown[] }).snapshots).toHaveLength(2);
    expectNoSecrets(res.body);
  });
});

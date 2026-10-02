/**
 * The Galactic Age lessons through the real tutorial start route: refused
 * server-side while `galaxy_tutorial_enabled` is switched off (hiding the
 * Academy card is not a gate), and seated as the lesson's spec says while it
 * is on, which it is by default — the human first, every seat with its
 * faction, the AI seats at tutorial difficulty.
 *
 * Needs Postgres (migrated schema, maps seeded), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/galaxyTutorial.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('Galactic Age tutorial lessons (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  let setAdminConfigCacheForTests: (patch: Record<string, unknown>) => void;
  let resetAdminConfigCacheForTests: () => void;
  let GALAXY_TUTORIAL_CLOSED_ERROR: string;
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

  function auth(user: { id: string; name: string }) {
    return { authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: false })}` };
  }

  function startLesson(user: { id: string; name: string }, lesson: string) {
    return app.inject({
      method: 'POST',
      url: '/api/games/tutorial/start',
      headers: auth(user),
      payload: { lesson_module: lesson },
    });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    ({ setAdminConfigCacheForTests, resetAdminConfigCacheForTests } = await import('../../services/adminConfig'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const routes = await import('./games.routes');
    GALAXY_TUTORIAL_CLOSED_ERROR = routes.GALAXY_TUTORIAL_CLOSED_ERROR;
    app = Fastify();
    registerErrorHandler(app);
    await app.register(routes.gamesRoutes, { prefix: '/api/games' });
    await app.ready();
  }, 30_000);

  afterEach(() => resetAdminConfigCacheForTests());

  afterAll(async () => {
    if (app) await app.close();
    if (gameIds.length) {
      await query('DELETE FROM games WHERE game_id = ANY($1)', [gameIds]).catch(() => {});
    }
    if (userIds.length) {
      await query('DELETE FROM users WHERE user_id = ANY($1)', [userIds]).catch(() => {});
    }
  });

  it('refuses a galaxy lesson while the flag is switched off, and still starts the core one', async () => {
    // On by default; the admin kill switch is what closes the track.
    setAdminConfigCacheForTests({ feature_flags: { galaxy_tutorial_enabled: false } });
    const user = await seedUser('gtut_off');
    const refused = await startLesson(user, 'galaxy_lane_sovereignty');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: GALAXY_TUTORIAL_CLOSED_ERROR });

    const core = await startLesson(user, 'core');
    expect(core.statusCode).toBe(201);
    gameIds.push((core.json() as { game_id: string }).game_id);
  });

  it('seats the Lane Sovereignty lesson as its spec says once the flag is on', async () => {
    setAdminConfigCacheForTests({ feature_flags: { galaxy_tutorial_enabled: true } });
    const user = await seedUser('gtut_on');
    const res = await startLesson(user, 'galaxy_lane_sovereignty');
    expect(res.statusCode).toBe(201);
    const { game_id: gameId } = res.json() as { game_id: string };
    gameIds.push(gameId);

    const [game] = await query(
      'SELECT map_id, era_id, status, game_type, settings_json FROM games WHERE game_id = $1',
      [gameId],
    );
    expect(game).toMatchObject({ map_id: 'era_galaxy', era_id: 'galaxy_age', status: 'waiting', game_type: 'solo' });
    const settings = game!.settings_json as Record<string, unknown>;
    expect(settings.tutorial).toBe(true);
    expect(settings.tutorial_lesson_module).toBe('galaxy_lane_sovereignty');
    expect(settings.allowed_victory_conditions).toContain('lane_sovereignty');
    expect(settings.authored_scenario).toBeTruthy();

    const seats = await query(
      `SELECT player_index, user_id, is_ai, ai_difficulty, faction_id
       FROM game_players WHERE game_id = $1 ORDER BY player_index`,
      [gameId],
    );
    expect(seats.map((s) => [s.player_index, s.is_ai, s.ai_difficulty, s.faction_id])).toEqual([
      [0, false, null, 'helion_navigators'],
      [1, true, 'tutorial', 'void_custodians'],
      [2, true, 'tutorial', 'forge_syndicate'],
    ]);
    expect(seats[0]!.user_id).toBe(user.id);
  });

  it('still refuses an id no lesson has', async () => {
    const user = await seedUser('gtut_bad');
    const res = await startLesson(user, 'galaxy_everything');
    expect(res.statusCode).toBe(400);
  });
});

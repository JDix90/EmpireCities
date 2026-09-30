/**
 * A Galactic Age lobby seats two to eight — Colonies, the classic start, and
 * from five the Schism — through the real create and join routes.
 *
 * Reported in the seat-count review, when five to seven seats had no board:
 * the lobby form asked for eight seats and filled four with AI, so a fifth
 * player could join by code and get a start the engine had none for. The
 * create route holds the form to a count the era plays, the join route caps a
 * Galactic lobby at the largest such count within its own cap (now every count
 * from two to eight), and Open Games never lists a Galactic lobby — the era is
 * admin-only, and a lobby that waits for humans waits for the ones it was sent
 * to.
 *
 * Needs Postgres (migrated schema, maps seeded), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/galaxyLobby.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('Galactic Age lobbies seat two to eight (Postgres)', () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let signAccessToken: (p: { sub: string; username: string; guest?: boolean; admin?: boolean }) => string;
  let GALAXY_PLAYER_COUNT_ERROR: string;
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

  function auth(user: { id: string; name: string }, admin = false) {
    return { authorization: `Bearer ${signAccessToken({ sub: user.id, username: user.name, guest: false, admin })}` };
  }

  function createGalaxy(admin: { id: string; name: string }, maxPlayers: number, aiCount: number) {
    return app.inject({
      method: 'POST',
      url: '/api/games',
      headers: auth(admin, true),
      payload: {
        era_id: 'galaxy_age',
        map_id: 'era_galaxy',
        max_players: maxPlayers,
        ai_count: aiCount,
        ai_difficulty: 'medium',
        settings: {
          turn_timer_seconds: 300,
          allowed_victory_conditions: ['domination'],
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: false,
          factions_enabled: true,
          economy_enabled: true,
          tech_trees_enabled: true,
        },
      },
    });
  }

  function join(gameId: string, user: { id: string; name: string }) {
    return app.inject({ method: 'POST', url: `/api/games/${gameId}/join`, headers: auth(user) });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
    ({ GALAXY_PLAYER_COUNT_ERROR } = await import('./lobbyCapacity'));
    const { registerErrorHandler } = await import('../../errorHandler');
    const { gamesRoutes } = await import('./games.routes');
    app = Fastify();
    registerErrorHandler(app);
    await app.register(gamesRoutes, { prefix: '/api/games' });
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

  it('opens a six-seat lobby, a Partial Schism, that takes humans up to six and no further', async () => {
    const admin = await seedUser('gal_admin6');
    const res = await createGalaxy(admin, 6, 3);
    expect(res.statusCode).toBe(201);
    const { game_id: gameId } = res.json() as { game_id: string };
    gameIds.push(gameId);

    // Host + three AI: two human seats left, then the lobby is full.
    const [a, b, c] = [await seedUser('gal6_a'), await seedUser('gal6_b'), await seedUser('gal6_c')];
    expect((await join(gameId, a)).statusCode).toBe(200);
    expect((await join(gameId, b)).statusCode).toBe(200);
    const seventh = await join(gameId, c);
    expect(seventh.statusCode).toBe(409);
    expect(seventh.json()).toMatchObject({ code: 'full' });
  });

  it('opens an eight-seat Schism lobby that takes humans up to eight and no further', async () => {
    const admin = await seedUser('gal_admin8');
    const res = await createGalaxy(admin, 8, 5);
    expect(res.statusCode).toBe(201);
    const { game_id: gameId } = res.json() as { game_id: string };
    gameIds.push(gameId);

    // Host + five AI: two human seats left, then the lobby is full.
    const [a, b, c] = [await seedUser('gal8_a'), await seedUser('gal8_b'), await seedUser('gal8_c')];
    expect((await join(gameId, a)).statusCode).toBe(200);
    expect((await join(gameId, b)).statusCode).toBe(200);
    const ninth = await join(gameId, c);
    expect(ninth.statusCode).toBe(409);
    expect(ninth.json()).toMatchObject({ code: 'full' });
  });

  it('refuses more AI than the seats it asked for', async () => {
    const admin = await seedUser('gal_adminai');
    const res = await createGalaxy(admin, 3, 3);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: GALAXY_PLAYER_COUNT_ERROR });
  });

  it('opens an unlisted four-seat lobby that takes humans up to four and no further', async () => {
    const admin = await seedUser('gal_admin4');
    const res = await createGalaxy(admin, 4, 1);
    expect(res.statusCode).toBe(201);
    const { game_id: gameId } = res.json() as { game_id: string };
    gameIds.push(gameId);

    const stranger = await seedUser('gal_stranger');
    const listed = await app.inject({ method: 'GET', url: '/api/games/public', headers: auth(stranger) });
    expect((listed.json() as Array<{ game_id: string }>).map((g) => g.game_id)).not.toContain(gameId);

    // Host + one AI: two human seats left, then the lobby is full.
    const [a, b, c] = [await seedUser('gal_a'), await seedUser('gal_b'), await seedUser('gal_c')];
    expect((await join(gameId, a)).statusCode).toBe(200);
    expect((await join(gameId, b)).statusCode).toBe(200);
    const fifth = await join(gameId, c);
    expect(fifth.statusCode).toBe(409);
    expect(fifth.json()).toMatchObject({ code: 'full' });
  });

  it('never lists a Galactic lobby in Open Games, even a public one a vote switched to the era', async () => {
    const host = await seedUser('gal_vote_host');
    const viewer = await seedUser('gal_vote_viewer');
    const seed = async (eraId: string, mapId: string) => {
      const gameId = uuidv4();
      gameIds.push(gameId);
      await query(
        `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_private)
         VALUES ($1, $2, $3, 'waiting', $4::jsonb, 'multiplayer', false)`,
        [gameId, mapId, eraId, JSON.stringify({ max_players: 4, factions_enabled: true })],
      );
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
         VALUES ($1, $2, 0, '#e74c3c', false)`,
        [gameId, host.id],
      );
      return gameId;
    };
    const galactic = await seed('galaxy_age', 'era_galaxy');
    const onTheBoard = await seed('custom', 'era_galaxy');
    const ordinary = await seed('ww2', 'era_ww2');

    const listed = await app.inject({ method: 'GET', url: '/api/games/public', headers: auth(viewer) });
    const ids = (listed.json() as Array<{ game_id: string }>).map((g) => g.game_id);
    expect(ids).not.toContain(galactic);
    expect(ids).not.toContain(onTheBoard);
    expect(ids).toContain(ordinary);
  });

  it('holds a stored cap of six seats to six, now that five to seven have a board', async () => {
    const host = await seedUser('gal_legacy_host');
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type)
       VALUES ($1, 'era_galaxy', 'galaxy_age', 'waiting', $2::jsonb, 'solo')`,
      [gameId, JSON.stringify({ max_players: 6, factions_enabled: true })],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, host.id],
    );
    for (let i = 1; i <= 3; i++) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
         VALUES ($1, NULL, $2, '#3498db', true)`,
        [gameId, i],
      );
    }
    // Host + three AI: a fifth and sixth seat for humans, then the lobby is full.
    const [fifth, sixth, seventh] = [
      await seedUser('gal_legacy_fifth'), await seedUser('gal_legacy_sixth'), await seedUser('gal_legacy_seventh'),
    ];
    expect((await join(gameId, fifth)).statusCode).toBe(200);
    expect((await join(gameId, sixth)).statusCode).toBe(200);
    const res = await join(gameId, seventh);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'full' });
  });
});

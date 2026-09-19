/**
 * `GET /api/games/public` must list only lobbies a stranger can actually join.
 *
 * Reported from testing: the lobby's "Open Games" list showed a game as
 * "2/8 players", and clicking Join answered **409 "Game is full"**. Two
 * independent causes, both reproduced below:
 *
 *  - The list ignored `settings_json.max_players`. `POST /:gameId/join`
 *    enforces it (`Math.min(8, Math.max(2, max_players ?? 8))`), so a lobby
 *    created by the lobby's own "Full Game" button — `max_players = aiCount + 1`
 *    — is FULL at 2 players, while the list happily advertised it. The `/8`
 *    the player read was the client hard-coding the cap, because the endpoint
 *    never returned one.
 *  - The list ignored `game_type`. Campaign missions, daily challenges and
 *    tutorials are all inserted `status = 'waiting'` with a human at seat 0,
 *    so somebody's single-player campaign was advertised as an open game —
 *    and campaign never writes `max_players`, so it was genuinely joinable.
 *
 * The contract pinned here: every row the endpoint returns can be joined, and
 * it carries the seat cap the client renders.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/games/publicGames.routes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

const enabled = process.env.PG_TEST === '1';

interface PublicGameRow {
  game_id: string;
  era_id: string;
  player_count: string | number;
  max_players: number;
}

describe.runIf(enabled)('GET /api/games/public — only joinable lobbies (Postgres)', () => {
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

  /**
   * A waiting lobby with `humanId` at seat 0 and `aiSeats` bot seats after it,
   * mirroring how the lobby / campaign / daily inserts build one.
   */
  async function seedLobby(opts: {
    humanId: string;
    aiSeats: number;
    gameType: 'multiplayer' | 'hybrid' | 'solo';
    settings: Record<string, unknown>;
    isRanked?: boolean;
  }): Promise<string> {
    const gameId = uuidv4();
    gameIds.push(gameId);
    await query(
      `INSERT INTO games (game_id, map_id, era_id, status, settings_json, game_type, is_ranked)
       VALUES ($1, 'era_ancient', 'ancient', 'waiting', $2::jsonb, $3, $4)`,
      [gameId, JSON.stringify(opts.settings), opts.gameType, !!opts.isRanked],
    );
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, '#e74c3c', false)`,
      [gameId, opts.humanId],
    );
    for (let i = 0; i < opts.aiSeats; i++) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
         VALUES ($1, NULL, $2, '#3498db', true)`,
        [gameId, i + 1],
      );
    }
    return gameId;
  }

  function listPublic(userId: string, username: string) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({
      method: 'GET',
      url: '/api/games/public',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  function joinGame(gameId: string, userId: string, username: string) {
    const token = signAccessToken({ sub: userId, username, guest: false });
    return app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/join`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    ({ query } = (await import('../../db/postgres')) as unknown as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    });
    ({ signAccessToken } = await import('../../utils/jwt'));
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

  it('a full lobby is not listed — and every listed row can actually be joined', async () => {
    const host = await seedUser('pub_host');
    const viewer = await seedUser('pub_viewer');

    // Exactly what LobbyPage.startFullGame creates when auto-start degrades to
    // a waiting room: max_players = aiCount + 1 = 2, with the AI already seated.
    const full = await seedLobby({
      humanId: host.id, aiSeats: 1, gameType: 'hybrid', settings: { max_players: 2 },
    });
    // A genuinely open 4-seat lobby, for contrast.
    const open = await seedLobby({
      humanId: host.id, aiSeats: 1, gameType: 'hybrid', settings: { max_players: 4 },
    });

    const res = await listPublic(viewer.id, viewer.name);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as PublicGameRow[];
    const ids = rows.map((r) => r.game_id);

    expect(ids).toContain(open);
    // The reported bug: this row was listed as "2/8" and 409'd on join.
    expect(ids).not.toContain(full);

    // The invariant behind the fix — no listed row rejects a join as full.
    const joined = await joinGame(open, viewer.id, viewer.name);
    expect(joined.statusCode).toBe(200);
  });

  it('the seat cap is returned, so the client never has to hard-code /8', async () => {
    const host = await seedUser('pub_cap_host');
    const viewer = await seedUser('pub_cap_viewer');
    const gameId = await seedLobby({
      humanId: host.id, aiSeats: 0, gameType: 'multiplayer', settings: { max_players: 3 },
    });

    const rows = (await listPublic(viewer.id, viewer.name)).json() as PublicGameRow[];
    const row = rows.find((r) => r.game_id === gameId);
    expect(row).toBeDefined();
    expect(row!.max_players).toBe(3);
    expect(Number(row!.player_count)).toBe(1);
  });

  it('a lobby with no max_players setting falls back to 8 seats, not to invisible', async () => {
    const host = await seedUser('pub_dflt_host');
    const viewer = await seedUser('pub_dflt_viewer');
    const gameId = await seedLobby({
      humanId: host.id, aiSeats: 0, gameType: 'multiplayer', settings: {},
    });

    const rows = (await listPublic(viewer.id, viewer.name)).json() as PublicGameRow[];
    const row = rows.find((r) => r.game_id === gameId);
    expect(row).toBeDefined();
    expect(row!.max_players).toBe(8);
  });

  it("single-player modes are not advertised as open games", async () => {
    const host = await seedUser('pub_solo_host');
    const viewer = await seedUser('pub_solo_viewer');

    // Campaign: `status='waiting'`, one human + AI, and NO max_players key —
    // so before the fix it read as "3/8 open seats" and a stranger could join
    // somebody's campaign mission.
    const campaign = await seedLobby({
      humanId: host.id, aiSeats: 2, gameType: 'solo',
      settings: { is_campaign: true, player_count: 3 },
    });
    const tutorial = await seedLobby({
      humanId: host.id, aiSeats: 1, gameType: 'solo',
      settings: { tutorial: true, tutorial_lesson_module: 'core', max_players: 2 },
    });
    const daily = await seedLobby({
      humanId: host.id, aiSeats: 1, gameType: 'solo',
      settings: { daily_challenge_date: '2026-01-01', max_players: 2 },
    });

    const rows = (await listPublic(viewer.id, viewer.name)).json() as PublicGameRow[];
    const ids = rows.map((r) => r.game_id);
    expect(ids).not.toContain(campaign);
    expect(ids).not.toContain(tutorial);
    expect(ids).not.toContain(daily);
  });

  it('a ranked matchmaking lobby is not advertised as an open game', async () => {
    const host = await seedUser('pub_ranked_host');
    const viewer = await seedUser('pub_ranked_viewer');
    const ranked = await seedLobby({
      humanId: host.id, aiSeats: 0, gameType: 'multiplayer',
      settings: { max_players: 4 }, isRanked: true,
    });

    const rows = (await listPublic(viewer.id, viewer.name)).json() as PublicGameRow[];
    expect(rows.map((r) => r.game_id)).not.toContain(ranked);
  });
});

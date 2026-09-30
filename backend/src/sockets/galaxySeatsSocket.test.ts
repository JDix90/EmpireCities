/**
 * The Galactic Age seats two to four, and game start is the last place that
 * holds a lobby to it: a lobby created before the create route capped the seat
 * count, or switched to the era by a vote, can still reach Start with five. And
 * a lobby inside the range starts on the board its seat count deals — at three,
 * the Colonies board with the ring's two gaps bridged on the game's map copy.
 *
 * Drives the real game:start handler over socket.io against Redis. The waiting
 * lobby (the games and game_players rows) is held in memory in place of
 * Postgres, and maps come from the committed JSON.
 *
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/galaxySeatsSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';

const db = vi.hoisted(() => ({
  games: new Map<string, { game_id: string; era_id: string; map_id: string; status: string; settings_json: Record<string, unknown> }>(),
  players: new Map<string, Array<Record<string, unknown>>>(),
}));

vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM game_players gp')) return db.players.get(params[0] as string) ?? [];
      if (sql.includes('UPDATE games SET status')) {
        const g = db.games.get(params[2] as string);
        if (g) g.status = params[0] as string;
      }
      return [];
    },
    queryOne: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT player_index') && sql.includes('FROM game_players')) {
        const seat = (db.players.get(params[0] as string) ?? []).find((p) => p.user_id === params[1]);
        return seat ? { player_index: seat.player_index } : null;
      }
      if (sql.includes('FROM games WHERE game_id')) {
        const g = db.games.get(params[0] as string);
        return g ? { ...g, join_code: 'ABCD', winner_id: null, is_ranked: false } : null;
      }
      return null;
    },
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: { query: async () => result, connect: async () => client, end: async () => {}, on: () => {}, waitingCount: 0, totalCount: 0, idleCount: 0 },
  };
});

vi.mock('./mapResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mapResolver')>();
  return {
    ...actual,
    resolveMap: async (mapId: string) =>
      JSON.parse(readFileSync(resolve(__dirname, '../../../database/maps', `${mapId}.json`), 'utf8')),
  };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import { GALAXY_PLAYER_COUNT_ERROR } from '../modules/games/lobbyCapacity';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('Galactic Age seats at game start', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let getGameState: (gameId: string) => Promise<import('../types').GameState | null>;
  let getGameMap: (gameId: string) => Promise<import('../types').GameMap | null>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    ({ getGameState, getGameMap } = await import('./redisGameStore'));
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => { /* lazyConnect */ });
    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, r));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => {});
    await new Promise<void>((r) => httpServer.close(() => r()));
  }, 30_000);

  afterEach(() => {
    while (openClients.length) openClients.pop()?.disconnect();
  });

  /** A waiting Galactic lobby: the host, then `aiSeats` bots, factions on as the create route bakes them. */
  function seedGalaxyLobby(gameId: string, host: string, aiSeats: number): void {
    db.games.set(gameId, {
      game_id: gameId, era_id: 'galaxy_age', map_id: 'era_galaxy', status: 'waiting',
      settings_json: {
        fog_of_war: false, allowed_victory_conditions: ['domination', 'threshold', 'lane_sovereignty'],
        victory_threshold: 60, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true,
        diplomacy_enabled: false, factions_enabled: true, economy_enabled: true, tech_trees_enabled: true,
        galaxy_corridors_enabled: true, max_turns: 90, max_players: 8,
      },
    });
    db.players.set(gameId, [
      { player_index: 0, user_id: host, username: host, player_color: '#e74c3c', is_ai: false, ai_difficulty: null, faction_id: null },
      ...Array.from({ length: aiSeats }, (_, i) => ({
        player_index: i + 1, user_id: null, username: null, player_color: '#3498db', is_ai: true, ai_difficulty: 'easy', faction_id: null,
      })),
    ]);
  }

  async function hostIn(gameId: string, host: string): Promise<ClientSocket> {
    const client = ClientIO(`http://localhost:${port}`, {
      auth: { token: signAccessToken({ sub: host, username: host }) },
      transports: ['websocket'], forceNew: true, reconnection: false,
    });
    openClients.push(client);
    await new Promise<void>((res, rej) => {
      client.once('connect', () => res());
      client.once('connect_error', rej);
    });
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === host);
      if (s) { s.join(gameId); break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    return client;
  }

  /** Press Start; resolve with whichever answer comes first. */
  function start(client: ClientSocket, gameId: string): Promise<{ started: true } | { error: string }> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no answer to game:start')), 10_000);
      client.once('game:started', () => { clearTimeout(timer); res({ started: true }); });
      client.once('error', (e: { message?: string }) => { clearTimeout(timer); res({ error: e.message ?? String(e) }); });
      client.emit('game:start', { gameId });
    });
  }

  it('refuses a lobby seating five, and leaves it waiting', async () => {
    const gameId = uuidv4();
    const host = `host_${gameId.slice(0, 8)}`;
    seedGalaxyLobby(gameId, host, 4);
    const client = await hostIn(gameId, host);

    expect(await start(client, gameId)).toEqual({ error: GALAXY_PLAYER_COUNT_ERROR });
    expect(db.games.get(gameId)!.status).toBe('waiting');
    expect(await getGameState(gameId)).toBeNull();
  }, 30_000);

  it('starts three seats on the Colonies board, bridges and all', async () => {
    const gameId = uuidv4();
    const host = `host_${gameId.slice(0, 8)}`;
    seedGalaxyLobby(gameId, host, 2);
    const client = await hostIn(gameId, host);

    expect(await start(client, gameId)).toEqual({ started: true });
    const state = await getGameState(gameId);
    expect(state?.galaxy_mode?.id).toBe('colonies');
    expect(state?.galaxy_mode?.neutral_worlds).toHaveLength(1);
    // The persisted map copy — what a reconnecting client is sent — carries the bridges.
    const map = await getGameMap(gameId);
    expect(map?.connections.filter((c) => c.source === 'galaxy_mode')).toHaveLength(2);
  }, 30_000);
});

/**
 * Waiting-room votes are held to the rules a create request is: a Custom Game
 * lobby's settings or theater may not change by vote into a shape the create
 * route would never produce.
 *
 * Drives the real game:lobby_propose / game:lobby_vote handlers over socket.io
 * against Redis. The waiting lobby itself (the games and game_players rows) is
 * held in memory in place of Postgres, and maps come from the committed JSON.
 *
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/lobbyVoteSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// A waiting Custom Game held in memory: one human host plus three AI, created
// with the lobby's defaults (WW2, Domination, every advanced feature off).
const db = vi.hoisted(() => ({
  games: new Map<string, { game_id: string; era_id: string; map_id: string; status: string; settings_json: string }>(),
  players: new Map<string, Array<Record<string, unknown>>>(),
}));

vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM game_players gp')) return db.players.get(params[0] as string) ?? [];
      if (sql.includes('UPDATE games SET settings_json')) {
        const g = db.games.get(params[0] as string);
        if (g) g.settings_json = params[1] as string;
      }
      if (sql.includes('UPDATE games SET era_id')) {
        const g = db.games.get(params[0] as string);
        if (g) { g.era_id = params[1] as string; g.map_id = params[2] as string; }
      }
      return [];
    },
    queryOne: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM games WHERE game_id')) {
        const g = db.games.get(params[0] as string);
        return g ? { ...g, join_code: 'ABCD', winner_id: null, is_ranked: false } : null;
      }
      if (sql.includes('is_admin')) return { is_admin: false };
      return null;
    },
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: { query: async () => result, connect: async () => client, end: async () => {}, on: () => {}, waitingCount: 0, totalCount: 0, idleCount: 0 },
  };
});

// Maps come from the committed JSON instead of Postgres.
vi.mock('./mapResolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mapResolver')>();
  return {
    ...actual,
    resolveMap: async (mapId: string) =>
      JSON.parse(readFileSync(resolve(__dirname, '../../../database/maps', `${mapId}.json`), 'utf8')),
  };
});

import { featureFlags } from '../config/featureFlags';
import {
  ASYNC_TURN_TIMER_ERROR,
  ORBIT_GATED_DEFAULT_MAX_TURNS,
  TERRITORY_DRAFT_FACTIONS_ERROR,
} from '../modules/games/createGameSettings';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('waiting-room votes follow the create-time rules', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
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

  function seedLobby(gameId: string, host: string, extra: Record<string, unknown> = {}): void {
    // What POST /api/games stores for the lobby's defaults (settings abridged
    // to the keys that matter; the route bakes these and normalizes).
    db.games.set(gameId, {
      game_id: gameId, era_id: 'ww2', map_id: 'era_ww2', status: 'waiting',
      settings_json: JSON.stringify({
        fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 300,
        initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
        card_set_bonus_cap: 30, max_players: 8, ...extra,
      }),
    });
    db.players.set(gameId, [
      { player_index: 0, user_id: host, username: host, player_color: '#e74c3c', is_ai: false, ai_difficulty: null, is_eliminated: false, faction_id: null },
      ...[1, 2, 3].map((i) => ({ player_index: i, user_id: null, username: null, player_color: '#3498db', is_ai: true, ai_difficulty: 'medium', is_eliminated: false, faction_id: null })),
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

  /**
   * The host alone proposes and approves: with one human the threshold is 1.
   * Returns what the proposal card said it would do.
   */
  async function pass(client: ClientSocket, gameId: string, setting: string, value: unknown): Promise<string> {
    const update = new Promise<Array<{ id: string; displayValue: string }>>((res) => client.once('game:lobby_proposal_update', res));
    const errors: string[] = [];
    client.on('error', (e: { message?: string }) => errors.push(e.message ?? String(e)));
    client.emit('game:lobby_propose', { gameId, setting, value });
    const proposals = await Promise.race([update, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no proposal; errors: ${errors.join('; ')}`)), 5000))]);
    const settled = new Promise((res) => client.once('game:lobby_proposal_update', res));
    client.emit('game:lobby_vote', { gameId, proposalId: proposals[0]!.id, approve: true });
    await settled;
    return proposals[0]!.displayValue;
  }

  /** A proposal the server refuses outright: the error it gives. */
  async function refused(client: ClientSocket, gameId: string, setting: string, value: unknown): Promise<string> {
    const error = new Promise<{ message: string }>((res) => client.once('error', res));
    client.emit('game:lobby_propose', { gameId, setting, value });
    return (await error).message;
  }

  function stored(gameId: string): Record<string, unknown> {
    return JSON.parse(db.games.get(gameId)!.settings_json);
  }

  it('turning Naval on also turns Economy on, which Ports and fleets need, and says so', async () => {
    const gameId = 'vote-naval';
    seedLobby(gameId, 'vote-host-1');
    const host = await hostIn(gameId, 'vote-host-1');
    expect(await pass(host, gameId, 'naval_enabled', true)).toBe('On — turns on Economy & Buildings');
    expect(stored(gameId)).toMatchObject({ naval_enabled: true, economy_enabled: true });
  }, 20_000);

  it('switching to the Space Age brings its systems, its Moon Race and its turn cap', async () => {
    const gameId = 'vote-space';
    seedLobby(gameId, 'vote-host-2');
    const host = await hostIn(gameId, 'vote-host-2');
    await pass(host, gameId, 'map_change', { era_id: 'space_age', map_id: 'era_space_age' });
    expect(db.games.get(gameId)!.era_id).toBe('space_age');
    const s = stored(gameId);
    expect({ economy: s.economy_enabled, tech: s.tech_trees_enabled, cap: s.max_turns, seats: s.max_players })
      .toEqual({ economy: true, tech: true, cap: ORBIT_GATED_DEFAULT_MAX_TURNS, seats: 8 });
    for (const [phase, shipped] of Object.entries(featureFlags.moonRacePhases)) {
      expect({ phase, on: s[phase] === true }).toEqual({ phase, on: shipped });
    }
  }, 20_000);

  it('refuses Factions in a Territory Draft lobby, as the create form does', async () => {
    const gameId = 'vote-draft-factions';
    seedLobby(gameId, 'vote-host-3', { territory_selection: true });
    const host = await hostIn(gameId, 'vote-host-3');
    expect(await refused(host, gameId, 'factions_enabled', true)).toBe(TERRITORY_DRAFT_FACTIONS_ERROR);
    expect(stored(gameId).factions_enabled).toBeUndefined();
  }, 20_000);

  it('refuses a turn timer in an async lobby, which runs on its own deadline', async () => {
    const gameId = 'vote-async-timer';
    seedLobby(gameId, 'vote-host-4', { async_mode: true });
    const host = await hostIn(gameId, 'vote-host-4');
    expect(await refused(host, gameId, 'turn_timer_seconds', 120)).toBe(ASYNC_TURN_TIMER_ERROR);
    expect(stored(gameId).turn_timer_seconds).toBe(300);
  }, 20_000);
});

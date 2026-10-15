/**
 * game:turn_ready realigns a turn's clock to the moment the player can act.
 * It counts only in the first 20 seconds of a turn, so a reconnect deep into a
 * turn cannot hand out a fresh clock. With first_turn_clock_wait_enabled a
 * seat's first turn (turn 1) is the exception: the client holds the signal
 * until the game-start briefing closes, however long the player reads it.
 *
 * Redis-gated like the rest of the Redis tier:
 *   redis-server --port 6399 --save '' --appendonly no --requirepass chronoredis --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/turnReadySocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres stand-in: answers the game lookups the socket paths make.
vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async () => [],
    queryOne: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT map_id, status FROM games')) return { map_id: params[0], status: 'in_progress' };
      if (sql.includes('SELECT map_id FROM games')) return { map_id: params[0] };
      return null;
    },
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: { query: async () => result, connect: async () => client, end: async () => {}, on: () => {}, waitingCount: 0, totalCount: 0, idleCount: 0 },
  };
});
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('game:turn_ready', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let adminConfig: typeof import('../services/adminConfig');

  const openClients: ClientSocket[] = [];
  const createdGames: string[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    getGameState = store.getGameState;
    setGameMap = store.setGameMap;
    deleteGameKeys = store.deleteGameKeys;
    adminConfig = await import('../services/adminConfig');
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => { /* lazyConnect — may already be connecting */ });

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => { /* best effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    adminConfig.resetAdminConfigCacheForTests();
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  function player(id: string, idx: number): PlayerState {
    return {
      player_id: id,
      player_index: idx,
      username: id.toUpperCase(),
      color: '#c0392b',
      is_ai: false,
      is_eliminated: false,
      territory_count: 1,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: [],
      ability_uses: {},
    } as PlayerState;
  }

  function terr(id: string, owner: string): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: 3, unit_type: 'infantry' } as TerritoryState;
  }

  /** Seat 0's turn, in a 5-minute game, that began `agoMs` ago. */
  async function seed(gameId: string, ids: [string, string], turnNumber: number, agoMs: number): Promise<number> {
    const startedAt = Date.now() - agoMs;
    await setGameState(gameId, {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'draft',
      current_player_index: 0,
      turn_number: turnNumber,
      players: [player(ids[0], 0), player(ids[1], 1)],
      territories: { a: terr('a', ids[0]), b: terr('b', ids[1]) },
      card_deck: [],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false,
        allowed_victory_conditions: ['domination'],
        turn_timer_seconds: 300,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
      },
      draft_units_remaining: 3,
      turn_started_at: startedAt,
      phase_deadline_at: startedAt + 300_000,
      era_modifiers: {},
    } as unknown as GameState);
    await setGameMap(gameId, {
      map_id: gameId,
      name: 'Turn Ready',
      era: 'medieval',
      territories: ['a', 'b'].map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: 'r',
      })),
      connections: [{ from: 'a', to: 'b', type: 'land' }],
      regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
    } as unknown as GameMap);
    createdGames.push(gameId);
    return startedAt;
  }

  async function connect(userId: string): Promise<ClientSocket> {
    const token = signAccessToken({ sub: userId, username: userId.toUpperCase() });
    const client = ClientIO(`http://localhost:${port}`, {
      auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false,
    });
    openClients.push(client);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('client connect timeout')), 10_000);
      client.once('connect', () => { clearTimeout(t); resolve(); });
      client.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    return client;
  }

  async function joinRoom(userId: string, gameId: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) {
        s.join(gameId);
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Seat 0 signals ready; returns its turn's start time afterwards. */
  async function ready(gameId: string, userId: string): Promise<number> {
    const client = await connect(userId);
    await joinRoom(userId, gameId);
    client.emit('game:turn_ready', { gameId });
    await sleep(400);
    return (await getGameState(gameId))!.turn_started_at;
  }

  function firstTurnWaits(on: boolean): void {
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { first_turn_clock_wait_enabled: on } });
  }

  it('starts the first turn\'s clock when the player is ready, however late, with the flag on', async () => {
    firstTurnWaits(true);
    const gameId = 'turn-ready-first-late';
    const startedAt = await seed(gameId, ['trf-a', 'trf-b'], 1, 90_000);
    const before = Date.now();
    const after = await ready(gameId, 'trf-a');
    expect(after).toBeGreaterThanOrEqual(before);
    const state = (await getGameState(gameId))!;
    expect(state.phase_deadline_at).toBeGreaterThanOrEqual(before + 300_000);
    expect(after).toBeGreaterThan(startedAt);
  }, 20_000);

  it('honours it once: a second signal on the same turn keeps the clock', async () => {
    firstTurnWaits(true);
    const gameId = 'turn-ready-first-once';
    const startedAt = await seed(gameId, ['tro-a', 'tro-b'], 1, 90_000);
    const first = await ready(gameId, 'tro-a');
    expect(first).toBeGreaterThan(startedAt);
    // Push the start back, as if the turn had run on, then signal again.
    const state = (await getGameState(gameId))!;
    await setGameState(gameId, { ...state, turn_started_at: first - 60_000 });
    const client = openClients[openClients.length - 1];
    client.emit('game:turn_ready', { gameId });
    await sleep(400);
    expect((await getGameState(gameId))!.turn_started_at).toBe(first - 60_000);
  }, 20_000);

  it('keeps the 20-second window on later turns, with the flag on', async () => {
    firstTurnWaits(true);
    const gameId = 'turn-ready-later-late';
    const startedAt = await seed(gameId, ['trl-a', 'trl-b'], 2, 90_000);
    expect(await ready(gameId, 'trl-a')).toBe(startedAt);
  }, 20_000);

  it('keeps the 20-second window on the first turn with the flag off', async () => {
    firstTurnWaits(false);
    const gameId = 'turn-ready-first-off';
    const startedAt = await seed(gameId, ['trx-a', 'trx-b'], 1, 90_000);
    expect(await ready(gameId, 'trx-a')).toBe(startedAt);
  }, 20_000);

  it('still realigns a signal inside the window, with the flag off', async () => {
    firstTurnWaits(false);
    const gameId = 'turn-ready-in-window';
    const startedAt = await seed(gameId, ['trw-a', 'trw-b'], 3, 5_000);
    expect(await ready(gameId, 'trw-a')).toBeGreaterThan(startedAt);
  }, 20_000);
});

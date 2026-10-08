/**
 * finalizeGame keeps the Galactic Age report's record: a Galactic Age game won
 * over the socket writes its result and seats, and any other game writes
 * nothing to those tables.
 *
 * Postgres is mocked (the record's statements are captured); Redis is real.
 * Gated on REDIS_TEST=1 like the other socket integration tests:
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/galaxyReportSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  tx: [] as Array<{ sql: string; params: unknown[] }>,
}));

// The `games` status transition must succeed (rowCount 1) or finalize bails as
// a duplicate; the record's statements run in a transaction and are captured.
vi.mock('../db/postgres', () => {
  const poolResult = { rows: [] as unknown[], rowCount: 1 };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      spies.tx.push({ sql, params });
      return { rows: [] as unknown[], rowCount: 1 };
    },
    release: () => {},
  };
  return {
    query: async () => [],
    queryOne: async () => null,
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: {
      query: async () => poolResult,
      connect: async () => client,
      end: async () => {},
      on: () => {},
      waitingCount: 0,
      totalCount: 0,
      idleCount: 0,
    },
  };
});

vi.mock('../game-engine/state/statsManager', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../game-engine/state/statsManager')>();
  return {
    ...mod,
    recordGameResults: async () => (
      { ratingDeltas: new Map(), ratingProvisional: new Map(), guestPlayerIds: new Set(), isRanked: false, xpEarnedByPlayer: {} }
    ),
  };
});

vi.mock('../game-engine/progression/progressionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../game-engine/progression/progressionService')>();
  return { ...mod, applyWinStreak: async () => 0 };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('the Galactic Age report records a game finalizeGame ends (socket integration)', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;

  const openClients: ClientSocket[] = [];
  const createdGames: string[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    setGameMap = store.setGameMap;
    deleteGameKeys = store.deleteGameKeys;
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => { /* lazyConnect — may already be connecting */ });

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
    spies.tx.length = 0;
  });

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const HUMAN = 'report_p1';
  const AI = 'ai_1';

  function player(id: string, idx: number, extras: Partial<PlayerState> = {}): PlayerState {
    return {
      player_id: id, player_index: idx, username: id.toUpperCase(), color: '#c0392b',
      is_ai: false, is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
      capital_territory_id: null, secret_mission: null, unlocked_techs: [], ability_uses: {},
      ...extras,
    } as PlayerState;
  }

  function terr(id: string, owner: string | null, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' } as TerritoryState;
  }

  /**
   * Turn 1 of a two-seat game: the human on `a` (4 units) beside the AI's only
   * territory `b` (1 unit). Dice [6,6,6 | 1] take `b` in one exchange and end
   * the game.
   */
  function buildState(gameId: string, era: string): GameState {
    return {
      game_id: gameId,
      era,
      map_id: gameId,
      phase: 'attack',
      current_player_index: 0,
      turn_number: 1,
      players: [player(HUMAN, 0), player(AI, 1, { is_ai: true, ai_difficulty: 'expert' })],
      territories: { a: terr('a', HUMAN, 4), b: terr('b', AI, 1) },
      card_deck: [
        { card_id: 'd1', territory_id: 'a', symbol: 'infantry' },
        { card_id: 'd2', territory_id: 'b', symbol: 'cavalry' },
      ],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false, allowed_victory_conditions: [], victory_type: 'domination',
        turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
      },
      draft_units_remaining: 0,
      turn_started_at: 1_700_000_000_000,
      era_modifiers: {},
      puzzle_dice_queue: [6, 6, 6, 1, ...Array(8).fill(1)],
    } as unknown as GameState;
  }

  function buildMap(gameId: string, era: string): GameMap {
    return {
      map_id: gameId,
      name: 'Galaxy Report Test',
      era,
      territories: [
        { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'home' },
        { territory_id: 'b', name: 'B', polygon: [], center_point: [1, 0], region_id: 'front' },
      ],
      connections: [{ from: 'a', to: 'b', type: 'land' }],
      regions: [
        { region_id: 'home', name: 'Home', bonus: 0 },
        { region_id: 'front', name: 'Front', bonus: 0 },
      ],
    } as GameMap;
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
      if (s) { s.join(gameId); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
  }

  /** Take `b` with the scripted dice in a game of this era, and wait for game over. */
  async function conquer(gameId: string, era: string): Promise<void> {
    await setGameState(gameId, buildState(gameId, era));
    await setGameMap(gameId, buildMap(gameId, era));
    createdGames.push(gameId);
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const over = waitFor(client, 'game:over');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    await over;
  }

  it('records a Galactic Age game as it ends: the game, then each seat', async () => {
    await conquer('galaxy-report-socket-1', 'galaxy_age');
    const game = spies.tx.find((q) => q.sql.includes('INSERT INTO galaxy_game_results'));
    expect(game, 'the game was recorded').toBeDefined();
    expect(game!.params).toEqual(['galaxy-report-socket-1', 2, 'scattered', null, null, 'last_standing', 1, null, 1, null]);
    const seats = spies.tx.filter((q) => q.sql.includes('INSERT INTO galaxy_game_result_seats'));
    expect(seats.map((q) => [q.params[1], q.params[3], q.params[4], q.params[11]])).toEqual([
      [0, false, null, true],
      [1, true, 'expert', false],
    ]);
  });

  it('records nothing for a game of any other era', async () => {
    await conquer('galaxy-report-socket-2', 'medieval');
    expect(spies.tx.some((q) => /galaxy_game_result/.test(q.sql))).toBe(false);
  });
});

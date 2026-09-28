/**
 * Leaving a game (game:leave, or the last human disconnecting) takes no game
 * lock. Whatever it does with the room it loaded must never land over a move
 * another player made in the meantime.
 *
 * Redis-gated like the rest of the Redis tier:
 *   redis-server --port 6399 --save '' --appendonly no --requirepass chronoredis --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/gameLeaveSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres stand-in: answers the game lookups the leave and disconnect paths make.
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

// Holds the NEXT state read open for 400ms after it returns, once a test arms
// it: the leaving side's read, so a move can land between its read and its
// write. In play that window is a few Redis round trips.
const slowNextRead = vi.hoisted(() => ({ armed: false }));
vi.mock('./redisGameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./redisGameStore')>();
  return {
    ...actual,
    getGameState: async (gameId: string) => {
      const s = await actual.getGameState(gameId);
      if (slowNextRead.armed) {
        slowNextRead.armed = false;
        await new Promise((r) => setTimeout(r, 400));
      }
      return s;
    },
  };
});
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('leaving a game', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let onPlayerConnected: (gameId: string, socketId: string, playerId: string) => Promise<void>;

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
    ({ onPlayerConnected } = await import('./gameRoomManager'));
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
    slowNextRead.armed = false;
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

  function terr(id: string, owner: string, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' } as TerritoryState;
  }

  /**
   * a (6) → b (1) → c: seat 0 attacks b with dice that win the first exchange.
   * Each test seats its own players: game:state goes to per-user rooms.
   */
  async function seedRace(gameId: string, ids: [string, string, string]): Promise<void> {
    const [p1, p2, p3] = ids;
    await setGameState(gameId, {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'attack',
      current_player_index: 0,
      turn_number: 3,
      players: [player(p1, 0), player(p2, 1), player(p3, 2)],
      territories: { a: terr('a', p1, 6), b: terr('b', p2, 1), c: terr('c', p3, 5) },
      card_deck: [{ card_id: 'd1', territory_id: 'a', symbol: 'infantry' }],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false,
        allowed_victory_conditions: ['domination'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
      },
      draft_units_remaining: 0,
      turn_started_at: Date.now(),
      era_modifiers: {},
      puzzle_dice_queue: [6, 6, 6, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    } as unknown as GameState);
    await setGameMap(gameId, {
      map_id: gameId,
      name: 'Leave Race',
      era: 'medieval',
      territories: ['a', 'b', 'c'].map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: 'r',
      })),
      connections: [{ from: 'a', to: 'b', type: 'land' }, { from: 'b', to: 'c', type: 'land' }],
      regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
    } as unknown as GameMap);
    createdGames.push(gameId);
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

  /** Join the server-side socket to the game room; `present` also records it as game:join does. */
  async function joinRoom(userId: string, gameId: string, present = false): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) {
        s.join(gameId);
        if (present) await onPlayerConnected(gameId, s.id, userId);
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** While `leave` holds the room it read, the player to move takes b. */
  async function captureWhileLeaving(attacker: ClientSocket, gameId: string, leave: () => void): Promise<void> {
    slowNextRead.armed = true;
    leave();
    await sleep(100);
    const combat = new Promise<{ result: { territory_captured: boolean } }>((resolve) =>
      attacker.once('game:combat_result', resolve));
    attacker.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    expect((await combat).result.territory_captured).toBe(true);
    await sleep(800); // the leaving side has resumed and finished
  }

  it('game:leave does not undo a capture made while it ran', async () => {
    const gameId = 'leave-race-leave';
    await seedRace(gameId, ['lv-a', 'lv-b', 'lv-c']);
    const a = await connect('lv-a');
    await joinRoom('lv-a', gameId);
    const c = await connect('lv-c');
    await joinRoom('lv-c', gameId);

    // c's page unmounts (navigation, a remount) while a attacks.
    await captureWhileLeaving(a, gameId, () => c.emit('game:leave', { gameId }));
    expect((await getGameState(gameId))!.territories.b.owner_id).toBe('lv-a');
  }, 20_000);

  it('the last human disconnecting does not undo a capture made meanwhile', async () => {
    const gameId = 'leave-race-disconnect';
    await seedRace(gameId, ['dc-a', 'dc-b', 'dc-c']);
    // a plays without being recorded present, so c's drop reads as the last
    // human leaving: the path that flushes the room before eviction.
    const a = await connect('dc-a');
    await joinRoom('dc-a', gameId);
    const c = await connect('dc-c');
    await joinRoom('dc-c', gameId, true);

    await captureWhileLeaving(a, gameId, () => c.disconnect());
    expect((await getGameState(gameId))!.territories.b.owner_id).toBe('dc-a');
  }, 20_000);
});

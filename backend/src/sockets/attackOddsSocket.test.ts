/**
 * `game:attack_odds` (combat_explain_enabled): the attacker's panel asks the
 * chance of taking each target and the server answers with the exact odds,
 * for legal pairs on the asker's own turn only, without touching the game.
 *
 * Redis-gated like the rest of the socket tier (REDIS_TEST=1). Postgres is
 * stubbed as in gameAttackSocket.test.ts: nothing here reaches it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async () => [],
    queryOne: async () => null,
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: {
      query: async () => result,
      connect: async () => client,
      end: async () => {},
      on: () => {},
      waitingCount: 0,
      totalCount: 0,
      idleCount: 0,
    },
  };
});
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

type OddsReply = { gameId: string; requestId?: string; odds: Array<{ fromId: string; toId: string; p: number }> };

describe.runIf(redisTestEnabled)('game:attack_odds socket', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let setFlags: (flags: Record<string, boolean>) => void;
  let resetFlags: () => void;
  let redisClient: typeof import('../db/redis').redis;

  const openClients: ClientSocket[] = [];
  const createdGames: string[] = [];

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    ({ setGameState, getGameState, setGameMap, deleteGameKeys } = store);
    const adminConfig = await import('../services/adminConfig');
    setFlags = (feature_flags) => adminConfig.setAdminConfigCacheForTests({ feature_flags });
    resetFlags = adminConfig.resetAdminConfigCacheForTests;
    const redisMod = await import('../db/redis');
    redisClient = redisMod.redis;
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

  beforeEach(async () => {
    for (const user of ['p1', 'p2']) {
      const keys = await redisClient.keys(`rl:sock:${user}:*`);
      if (keys.length) await redisClient.del(...keys);
    }
    setFlags({ combat_explain_enabled: true });
  });

  afterEach(async () => {
    resetFlags();
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  function player(id: string, idx: number): PlayerState {
    return {
      player_id: id, player_index: idx, username: id.toUpperCase(), color: '#c0392b', is_ai: false,
      is_eliminated: false, territory_count: 1, cards: [], mmr: 1000, capital_territory_id: null,
      secret_mission: null, unlocked_techs: [], ability_uses: {},
    } as PlayerState;
  }
  const terr = (id: string, owner: string | null, units: number) =>
    ({ territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' }) as TerritoryState;

  /** p1 (to move) holds `a`, bordering p2's thin `b` and strong `c`; p2's `d` borders nothing of p1's. */
  async function seed(gameId: string): Promise<void> {
    const state = {
      game_id: gameId, era: 'medieval', map_id: gameId, phase: 'attack', current_player_index: 0, turn_number: 3,
      players: [player('p1', 0), player('p2', 1)],
      territories: { a: terr('a', 'p1', 6), b: terr('b', 'p2', 1), c: terr('c', 'p2', 9), d: terr('d', 'p2', 1) },
      card_deck: [], card_set_redemption_count: 0, diplomacy: [],
      settings: { fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0, initial_unit_count: 3, diplomacy_enabled: false },
      draft_units_remaining: 0, turn_started_at: 1_700_000_000_000, era_modifiers: {},
    } as unknown as GameState;
    const map = {
      map_id: gameId, name: 'Odds Test', era: 'medieval',
      territories: ['a', 'b', 'c', 'd'].map((id, i) => ({ territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: 'r' })),
      connections: [
        { from: 'a', to: 'b', type: 'land' },
        { from: 'a', to: 'c', type: 'land' },
        { from: 'c', to: 'd', type: 'land' },
      ],
      regions: [{ region_id: 'r', name: 'Region', bonus: 0 }],
    } as unknown as GameMap;
    await setGameState(gameId, state);
    await setGameMap(gameId, map);
    createdGames.push(gameId);
  }

  async function connect(userId: string): Promise<ClientSocket> {
    const token = signAccessToken({ sub: userId, username: userId.toUpperCase() });
    const client = ClientIO(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    openClients.push(client);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('client connect timeout')), 10_000);
      client.once('connect', () => { clearTimeout(t); resolve(); });
      client.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    return client;
  }

  /** The reply, or null when none comes within `ms`. */
  function ask(client: ClientSocket, payload: unknown, ms = 2_000): Promise<OddsReply | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => { client.off('game:attack_odds', on); resolve(null); }, ms);
      const on = (reply: OddsReply) => { clearTimeout(t); client.off('game:attack_odds', on); resolve(reply); };
      client.on('game:attack_odds', on);
      client.emit('game:attack_odds', payload);
    });
  }

  it('prices the asker\'s legal targets and leaves the game as it was', async () => {
    const gameId = `odds-${Date.now()}-1`;
    await seed(gameId);
    const p1 = await connect('p1');
    const reply = await ask(p1, {
      gameId,
      requestId: 'odds-7',
      pairs: [
        { fromId: 'a', toId: 'b' },
        { fromId: 'a', toId: 'c' },
        { fromId: 'a', toId: 'd' }, // not a neighbour
        { fromId: 'c', toId: 'a' }, // not p1's stack
      ],
    });
    expect(reply).not.toBeNull();
    expect(reply!.gameId).toBe(gameId);
    expect(reply!.requestId).toBe('odds-7');
    expect(reply!.odds.map((o) => o.toId)).toEqual(['b', 'c']);
    const [b, c] = reply!.odds;
    expect(b.p).toBeGreaterThan(0.9);
    expect(c.p).toBeLessThan(0.3);
    const after = await getGameState(gameId);
    expect(after!.territories.a.unit_count).toBe(6);
    expect(after!.territories.b.unit_count).toBe(1);
  }, 20_000);

  it('answers nobody but the player whose attack phase it is', async () => {
    const gameId = `odds-${Date.now()}-2`;
    await seed(gameId);
    const p2 = await connect('p2');
    expect(await ask(p2, { gameId, pairs: [{ fromId: 'c', toId: 'a' }] }, 600)).toBeNull();
  }, 20_000);

  it('stays silent with the flag off', async () => {
    setFlags({ combat_explain_enabled: false });
    const gameId = `odds-${Date.now()}-3`;
    await seed(gameId);
    const p1 = await connect('p1');
    expect(await ask(p1, { gameId, pairs: [{ fromId: 'a', toId: 'b' }] }, 600)).toBeNull();
  }, 20_000);
});

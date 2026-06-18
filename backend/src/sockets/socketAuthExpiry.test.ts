/**
 * Integration coverage for socket access-token expiry enforcement + cooperative
 * in-place refresh (socketAuth.ts), driven through a REAL socket.io server and
 * client. Proves the wire behaviour: an expired socket's events are dropped
 * (with auth:expired) and `auth:refresh` re-validates it in place.
 *
 * Redis-gated (REDIS_TEST=1) like the rest of the Redis tier; skips in plain
 * unit runs. Locally:
 *   REDIS_TEST=1 pnpm exec vitest run src/sockets/socketAuthExpiry.test.ts
 */
// Zero the expiry grace so a short-lived token expires deterministically and
// fast (set before gameSocket/socketAuth is dynamically imported below).
process.env.SOCKET_AUTH_GRACE_MS = '0';

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';
const MS_PER_SECOND = 1000;

describe.runIf(redisTestEnabled)('socket auth expiry + refresh integration', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }, expiresIn?: string) => string;
  let verifyAccessToken: (token: string) => { exp?: number } | null;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;

  const openClients: ClientSocket[] = [];
  const SEED_GAME = 'authtest-game';

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken, verifyAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    setGameMap = store.setGameMap;
    deleteGameKeys = store.deleteGameKeys;
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => {});

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    // Seed a real Redis game so a post-refresh action reaches a handler (and is
    // rejected as "not your turn") — proving the event was NOT auth-dropped,
    // without needing Postgres.
    await setGameState(SEED_GAME, buildState(SEED_GAME));
    await setGameMap(SEED_GAME, buildMap(SEED_GAME));
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await deleteGameKeys(SEED_GAME).catch(() => {});
    await shutdownGameSocket(ioServer).catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(() => {
    while (openClients.length) openClients.pop()?.disconnect();
  });

  function player(id: string, idx: number): PlayerState {
    return {
      player_id: id, player_index: idx, username: id.toUpperCase(), color: '#c0392b',
      is_ai: false, is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
      capital_territory_id: null, secret_mission: null, unlocked_techs: [], ability_uses: {},
    } as PlayerState;
  }
  function terr(id: string, owner: string | null, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' } as TerritoryState;
  }
  function buildState(gameId: string): GameState {
    return {
      game_id: gameId, era: 'medieval', map_id: gameId, phase: 'attack',
      current_player_index: 0, turn_number: 3,
      players: [player('p1', 0), player('p2', 1)],
      territories: { a: terr('a', 'p1', 4), b: terr('b', 'p2', 1) },
      card_deck: [], card_set_redemption_count: 0, diplomacy: [],
      settings: {
        fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0,
        initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
      },
      draft_units_remaining: 0, turn_started_at: 1_700_000_000_000, era_modifiers: {},
    } as GameState;
  }
  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId, name: 'Auth Test', era: 'medieval',
      territories: [
        { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
        { territory_id: 'b', name: 'B', polygon: [], center_point: [1, 0], region_id: 'r' },
      ],
      connections: [{ from: 'a', to: 'b', type: 'land' }],
      regions: [{ region_id: 'r', name: 'Region', bonus: 0 }],
    } as GameMap;
  }

  async function connect(token: string): Promise<ClientSocket> {
    const client = ClientIO(`http://localhost:${port}`, {
      auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false,
    });
    openClients.push(client);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
      client.once('connect', () => { clearTimeout(t); resolve(); });
      client.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
    return client;
  }

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs = 4_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
  }

  async function waitUntilExpired(token: string, bufferMs = 150): Promise<void> {
    const payload = verifyAccessToken(token);
    if (typeof payload?.exp !== 'number') throw new Error('expected fresh access token with exp');
    const waitMs = Math.max(0, payload.exp * MS_PER_SECOND - Date.now()) + bufferMs;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  it('drops events and emits auth:expired once the access token has expired', async () => {
    const token = signAccessToken({ sub: 'u-exp', username: 'EXP' }, '3s');
    const client = await connect(token);
    await waitUntilExpired(token);

    const expired = waitFor(client, 'auth:expired');
    client.emit('game:attack', { gameId: SEED_GAME, fromId: 'a', toId: 'b' });
    await expect(expired).resolves.toBeTruthy();
  }, 15_000);

  it('accepts auth:refresh (same user) and resumes processing events in place', async () => {
    const token = signAccessToken({ sub: 'u-ref', username: 'REF' }, '3s');
    const client = await connect(token);
    await waitUntilExpired(token);

    // Confirm it's actually expired first.
    const exp1 = waitFor(client, 'auth:expired');
    client.emit('game:attack', { gameId: SEED_GAME, fromId: 'a', toId: 'b' });
    await exp1;

    // Push a fresh long-lived token for the SAME user → extends the socket.
    const refreshed = waitFor(client, 'auth:refreshed');
    client.emit('auth:refresh', signAccessToken({ sub: 'u-ref', username: 'REF' }, '1h'));
    await expect(refreshed).resolves.toEqual({ ok: true });

    // A subsequent action now reaches the handler (rejected as "not your turn"
    // since u-ref isn't a player) instead of being auth-dropped.
    const outcome = await new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve('silent'), 3000);
      client.once('auth:expired', () => { clearTimeout(t); resolve('auth:expired'); });
      client.once('error', () => { clearTimeout(t); resolve('handler-ran'); });
      client.emit('game:attack', { gameId: SEED_GAME, fromId: 'a', toId: 'b' });
    });
    expect(outcome).toBe('handler-ran');
  }, 15_000);

  it('rejects an auth:refresh token belonging to a different user', async () => {
    const token = signAccessToken({ sub: 'u-victim', username: 'VICTIM' }, '3s');
    const client = await connect(token);
    await waitUntilExpired(token);

    let refreshed = false;
    client.on('auth:refreshed', () => { refreshed = true; });
    // Attacker token for a different sub must NOT extend this socket.
    client.emit('auth:refresh', signAccessToken({ sub: 'u-attacker', username: 'ATTACKER' }, '1h'));

    // Still expired: next event is dropped with auth:expired, and no refresh ack.
    const expired = waitFor(client, 'auth:expired');
    client.emit('game:attack', { gameId: SEED_GAME, fromId: 'a', toId: 'b' });
    await expect(expired).resolves.toBeTruthy();
    expect(refreshed).toBe(false);
  }, 15_000);
});

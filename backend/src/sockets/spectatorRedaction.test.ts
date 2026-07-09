/**
 * Integration coverage for spectator state redaction (the fog-of-war / card-hand
 * leak fix), driven through a REAL socket.io server + a real `game:spectate_join`
 * against Redis-backed game state and a Postgres `games` row.
 *
 * Proves the WIRE delivers a redacted snapshot to a spectator:
 *   - card hands are emptied for every player (in fog AND non-fog games);
 *   - in a fog game, every territory's exact intel is masked (unit_count -1)
 *     while ownership (board control) stays visible.
 *
 * Needs BOTH Redis and Postgres, so it's gated on REDIS_TEST=1 && PG_TEST=1
 * (CI provides only Redis, so this skips there — run it locally/staging):
 *   REDIS_TEST=1 PG_TEST=1 POSTGRES_HOST=localhost POSTGRES_PORT=5499 \
 *     POSTGRES_USER=postgres POSTGRES_DB=borderfall POSTGRES_PASSWORD=x \
 *     pnpm exec vitest run src/sockets/spectatorRedaction.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const enabled = process.env.REDIS_TEST === '1' && process.env.PG_TEST === '1';

const FOG_GID = '11111111-1111-4111-8111-111111111111';
const NOFOG_GID = '22222222-2222-4222-8222-222222222222';

describe.runIf(enabled)('spectator state redaction integration', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let query: (sql: string, params?: unknown[]) => Promise<unknown>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    // Spectating is dark-launched off by default; this suite exercises the
    // spectate path itself, so enable it via the admin-config override.
    const adminConfig = await import('../services/adminConfig');
    adminConfig.setAdminConfigCacheForTests({ feature_flags: { spectate_enabled: true } });

    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState;
    setGameMap = store.setGameMap;
    deleteGameKeys = store.deleteGameKeys;
    ({ query } = await import('../db/postgres'));
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => {});

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    for (const [gid, fog] of [[FOG_GID, true], [NOFOG_GID, false]] as const) {
      await query('DELETE FROM games WHERE game_id = $1', [gid]).catch(() => {});
      await query(
        `INSERT INTO games (game_id, map_id, era_id, status) VALUES ($1, $2, 'medieval', 'in_progress')`,
        [gid, gid],
      );
      await setGameState(gid, buildFogState(gid, fog));
      await setGameMap(gid, buildMap(gid));
    }
  }, 30_000);

  afterAll(async () => {
    const adminConfig = await import('../services/adminConfig');
    adminConfig.resetAdminConfigCacheForTests();
    for (const c of openClients) c.disconnect();
    for (const gid of [FOG_GID, NOFOG_GID]) {
      await deleteGameKeys(gid).catch(() => {});
      await query('DELETE FROM games WHERE game_id = $1', [gid]).catch(() => {});
    }
    await shutdownGameSocket(ioServer).catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  function player(id: string, idx: number, cards: number): PlayerState {
    return {
      player_id: id, player_index: idx, username: id.toUpperCase(), color: '#c0392b',
      is_ai: false, is_eliminated: false, territory_count: 1,
      cards: Array.from({ length: cards }, (_, i) => ({ card_id: `${id}-c${i}`, territory_id: 'a', symbol: 'infantry' })),
      mmr: 1000, capital_territory_id: null, secret_mission: null, unlocked_techs: [], ability_uses: {},
    } as unknown as PlayerState;
  }
  function terr(id: string, owner: string | null, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', buildings: ['fort'], naval_units: 2 } as unknown as TerritoryState;
  }
  function buildFogState(gameId: string, fog: boolean): GameState {
    return {
      game_id: gameId, era: 'medieval', map_id: gameId, phase: 'attack',
      current_player_index: 0, turn_number: 3,
      players: [player('p1', 0, 3), player('p2', 1, 2)],
      territories: { a: terr('a', 'p1', 5), b: terr('b', 'p2', 3), c: terr('c', null, 1) },
      card_deck: [], card_set_redemption_count: 0, diplomacy: [],
      settings: {
        fog_of_war: fog, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0,
        initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
      },
      draft_units_remaining: 0, turn_started_at: 1_700_000_000_000, era_modifiers: {},
    } as GameState;
  }
  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId, name: 'Spectator Test', era: 'medieval',
      territories: [
        { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
        { territory_id: 'b', name: 'B', polygon: [], center_point: [1, 0], region_id: 'r' },
        { territory_id: 'c', name: 'C', polygon: [], center_point: [2, 0], region_id: 'r' },
      ],
      connections: [{ from: 'a', to: 'b', type: 'land' }, { from: 'b', to: 'c', type: 'land' }],
      regions: [{ region_id: 'r', name: 'Region', bonus: 0 }],
    } as GameMap;
  }

  async function connect(userId: string): Promise<ClientSocket> {
    const token = signAccessToken({ sub: userId, username: userId.toUpperCase() });
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

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs = 6_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
  }

  it('hides all card hands AND masks territory intel for a spectator of a FOG game', async () => {
    const spec = await connect('spectator-1');
    const state = waitFor<GameState>(spec, 'game:state');
    spec.emit('game:spectate_join', { gameId: FOG_GID });
    const snap = await state;

    // No card hands leak — every player's hand is empty.
    expect(snap.players.map((p) => p.cards.length)).toEqual([0, 0]);
    // Fog masks every territory's exact counts (spectator owns nothing visible)…
    for (const t of Object.values(snap.territories)) {
      expect(t.unit_count).toBe(-1);
    }
    // …but board control (ownership) stays visible.
    expect(snap.territories.a.owner_id).toBe('p1');
    expect(snap.territories.b.owner_id).toBe('p2');
  }, 20_000);

  it('hides card hands but keeps real territory counts for a spectator of a NON-fog game', async () => {
    const spec = await connect('spectator-2');
    const state = waitFor<GameState>(spec, 'game:state');
    spec.emit('game:spectate_join', { gameId: NOFOG_GID });
    const snap = await state;

    // Cards still hidden (private regardless of fog)…
    expect(snap.players.map((p) => p.cards.length)).toEqual([0, 0]);
    // …but with no fog, real territory intel is visible.
    expect(snap.territories.a.unit_count).toBe(5);
    expect(snap.territories.b.unit_count).toBe(3);
  }, 20_000);
});

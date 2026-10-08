/**
 * Where bots aim reaches `game_finished` (services/botAimTelemetry.ts): a bot
 * takes the human's last territory on its own turn, the game ends, and the
 * human's finish event counts that capture as from a player, from a human, and
 * from the bot's leading and weakest rival alike, its only rival.
 *
 * Postgres is mocked so finalizeGame runs through; Redis is real. Gated on
 * REDIS_TEST=1 like the other socket integration tests:
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/botAimTelemetrySocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  events: [] as Array<{ event: string; payload: Record<string, unknown>; userId: string | null | undefined }>,
}));

// The `games` status transition must succeed (rowCount 1) or finalize bails as a duplicate.
vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 1 };
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

vi.mock('../services/analyticsEvents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/analyticsEvents')>();
  return {
    ...mod,
    recordServerEvent: (event: string, payload: Record<string, unknown> = {}, userId?: string | null) => {
      spies.events.push({ event, payload, userId });
    },
  };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('where bots aim reaches game_finished (socket integration)', () => {
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
    spies.events.length = 0;
  });

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const HUMAN = 'aim_p1';
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
   * The human's fortify step: their one territory `a` holds 1 unit beside the
   * bot's `b` with 12. The scripted dice win every exchange for the attacker,
   * so the bot's turn takes `a` and ends the game.
   */
  function buildState(gameId: string): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'fortify',
      current_player_index: 0,
      turn_number: 3,
      players: [player(HUMAN, 0), player(AI, 1, { is_ai: true, ai_difficulty: 'hard' })],
      territories: { a: terr('a', HUMAN, 1), b: terr('b', AI, 12) },
      card_deck: [
        { card_id: 'd1', territory_id: 'a', symbol: 'infantry' },
        { card_id: 'd2', territory_id: 'b', symbol: 'cavalry' },
      ],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false, allowed_victory_conditions: ['domination'], victory_type: 'domination',
        turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
      },
      draft_units_remaining: 0,
      turn_started_at: 1_700_000_000_000,
      era_modifiers: {},
      puzzle_dice_queue: Array.from({ length: 12 }, () => [6, 6, 6, 1]).flat(),
    } as unknown as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Bot Aim Test',
      era: 'medieval',
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

  it('counts the bot\'s capture of the human\'s last territory on the human\'s game_finished', async () => {
    const gameId = `itest-bot-aim-${process.pid}-${Date.now()}`;
    await setGameState(gameId, buildState(gameId));
    await setGameMap(gameId, buildMap(gameId));
    createdGames.push(gameId);
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const over = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for game:over')), 30_000);
      client.once('game:over', () => { clearTimeout(t); resolve(); });
    });
    // The human ends their turn; the bot's turn takes `a`.
    client.emit('game:advance_phase', { gameId });
    await over;

    const finished = spies.events.filter((e) => e.event === 'game_finished');
    expect(finished.map((e) => e.userId)).toEqual([HUMAN]);
    expect(finished[0]!.payload).toMatchObject({
      game_id: gameId,
      won: false,
      ai_difficulty: 'hard',
      ai_captures_from_players: 1,
      ai_captures_from_humans: 1,
      ai_captures_from_leader: 1,
      ai_captures_from_weakest: 1,
    });
  }, 45_000);
});

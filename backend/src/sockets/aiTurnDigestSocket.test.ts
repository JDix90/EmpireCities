/**
 * `game:ai_turn_digest`: the digest of a bot's turn (ai/aiTurnDigest.ts)
 * reaches the room once the turn is played and before it is handed on, with
 * ai_intents_enabled on, and never with it off.
 *
 * Redis-gated like the other socket integration tests. Locally:
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/aiTurnDigestSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// A no-op Postgres, as in cardsRedeemedSocket.test.ts.
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
import type { AiTurnDigest } from '../game-engine/ai/aiTurnDigest';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('game:ai_turn_digest (socket integration)', () => {
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
    vi.unstubAllEnvs();
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const HUMAN = 'digest_p1';
  const AI = 'ai_1';

  function player(id: string, idx: number, extras: Partial<PlayerState> = {}): PlayerState {
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
      ...extras,
    } as PlayerState;
  }

  function terr(id: string, owner: string | null, units: number): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' } as TerritoryState;
  }

  /**
   *   a ─ b ─ c ─ d     west (a, b), east (c, d). The bot holds b with a big
   *                     stack between two thin tiles of the human's; the
   *                     human's d is out of its reach this turn.
   */
  function buildState(gameId: string): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'fortify',
      current_player_index: 0,
      turn_number: 3,
      players: [
        player(HUMAN, 0, { territory_count: 3 }),
        player(AI, 1, { is_ai: true, ai_difficulty: 'medium' }),
      ],
      territories: { a: terr('a', HUMAN, 1), b: terr('b', AI, 14), c: terr('c', HUMAN, 1), d: terr('d', HUMAN, 9) },
      card_deck: [{ card_id: 'd1', territory_id: 'a', symbol: 'cavalry' }],
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
      turn_started_at: 1_700_000_000_000,
      era_modifiers: {},
      // Three attacker dice then one defender die per exchange (combatResolver):
      // sixes against a one, so every attack on a single unit wins.
      puzzle_dice_queue: Array.from({ length: 80 }, (_, i) => (i % 4 === 3 ? 1 : 6)),
    } as unknown as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Digest Test',
      era: 'medieval',
      territories: [
        { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'west' },
        { territory_id: 'b', name: 'B', polygon: [], center_point: [1, 0], region_id: 'west' },
        { territory_id: 'c', name: 'C', polygon: [], center_point: [2, 0], region_id: 'east' },
        { territory_id: 'd', name: 'D', polygon: [], center_point: [3, 0], region_id: 'east' },
      ],
      connections: [
        { from: 'a', to: 'b', type: 'land' },
        { from: 'b', to: 'c', type: 'land' },
        { from: 'c', to: 'd', type: 'land' },
      ],
      regions: [
        { region_id: 'west', name: 'The West', bonus: 2 },
        { region_id: 'east', name: 'The East', bonus: 2 },
      ],
    } as GameMap;
  }

  // ── Harness helpers ───────────────────────────────────────────────────────────

  async function seed(gameId: string, state: GameState): Promise<void> {
    await setGameState(gameId, state);
    await setGameMap(gameId, buildMap(gameId));
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

  async function joinRoom(userId: string, gameId: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) { s.join(gameId); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  /**
   * Hands the turn to the bot and records, in order, every digest and the
   * state that hands the turn back to the human.
   */
  async function playBotTurn(gameId: string): Promise<Array<{ event: string; payload: unknown }>> {
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const seen: Array<{ event: string; payload: unknown }> = [];
    const back = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for the turn to come back')), 30_000);
      client.on('game:ai_turn_digest', (payload: unknown) => seen.push({ event: 'digest', payload }));
      client.on('game:state', (s: GameState) => {
        if (s.game_id === gameId && s.turn_number > 3 && s.players[s.current_player_index]?.player_id === HUMAN) {
          seen.push({ event: 'back', payload: null });
          clearTimeout(t);
          resolve();
        }
      });
    });
    client.emit('game:advance_phase', { gameId });
    await back;
    return seen;
  }

  /**
   * A fresh id per run. An AI turn keeps playing after the test has what it
   * needs, holding the per-game Redis lock; a fixed id would let a previous
   * run's still-held lock block this run's hand-off.
   */
  const freshGameId = (label: string) => `itest-digest-${label}-${process.pid}-${Date.now()}`;

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('tells the room what the bot did, and its goal, before handing the turn on', async () => {
    vi.stubEnv('AI_INTENTS_ENABLED', 'true');
    const gameId = freshGameId('on');
    await seed(gameId, buildState(gameId));

    const seen = await playBotTurn(gameId);
    expect(seen.map((e) => e.event)).toEqual(['digest', 'back']);
    const digest = seen[0]!.payload as AiTurnDigest;
    expect(digest.playerId).toBe(AI);
    expect(digest.turnNumber).toBe(3);
    expect(digest.taken.map((t) => t.territoryId).sort()).toEqual(['a', 'c']);
    expect(digest.taken.every((t) => t.fromPlayerId === HUMAN)).toBe(true);
    expect(digest.regionsTaken).toEqual([{ regionId: 'west', name: 'The West' }]);
    expect(digest.regionsBroken).toEqual([{ regionId: 'east', name: 'The East', fromPlayerId: HUMAN }]);
    // Medium names its goal; this board offers it the west to take or the east to break.
    expect(['The West', 'The East']).toContain(digest.goal?.name);
  }, 45_000);

  it('sends nothing with the flag off', async () => {
    vi.stubEnv('AI_INTENTS_ENABLED', 'false');
    const gameId = freshGameId('off');
    await seed(gameId, buildState(gameId));

    const seen = await playBotTurn(gameId);
    expect(seen.map((e) => e.event)).toEqual(['back']);
  }, 45_000);
});

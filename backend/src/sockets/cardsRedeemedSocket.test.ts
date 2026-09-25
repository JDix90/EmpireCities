/**
 * `game:cards_redeemed` names the seat that redeemed.
 *
 * The event reaches the redeeming socket when a human redeems and the whole
 * room when an AI does (`processAiTurn`). The client treated every one as its
 * own: a toast, a haptic and the bonus added to this player's reinforcement
 * counter. With three medium AIs at the table that was a "Card set redeemed!"
 * toast on the human's screen, and an inflated counter, on every AI
 * redemption. The payload now carries `playerId`; this drives both paths for
 * real and reads it back.
 *
 * Redis-gated like the other socket integration tests. Locally:
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/cardsRedeemedSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// A no-op Postgres, as in gameAttackSocket.test.ts: the fixture ids are not
// UUIDs and nothing here is asserted on the database side.
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
import type { GameState, GameMap, PlayerState, TerritoryState, TerritoryCard } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('game:cards_redeemed names the redeeming seat (socket integration)', () => {
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
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  const HUMAN = 'p1';
  const AI = 'ai_1';

  /** Three of a kind: always a valid set. */
  function infantrySet(prefix: string): TerritoryCard[] {
    return ['a', 'b', 'c'].map((t) => ({ card_id: `${prefix}-${t}`, territory_id: t, symbol: 'infantry' as const }));
  }

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

  /** A two-seat game: the human on `a` and `c`, the AI on `b` between them. */
  function buildState(gameId: string, over: Partial<GameState>): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'draft',
      current_player_index: 0,
      turn_number: 3,
      players: [
        player(HUMAN, 0, { territory_count: 2 }),
        player(AI, 1, { is_ai: true, ai_difficulty: 'easy' }),
      ],
      territories: { a: terr('a', HUMAN, 4), b: terr('b', AI, 3), c: terr('c', HUMAN, 2) },
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
      puzzle_dice_queue: Array(40).fill(1),
      ...over,
    } as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Cards Test',
      era: 'medieval',
      territories: [
        { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
        { territory_id: 'b', name: 'B', polygon: [], center_point: [1, 0], region_id: 'r' },
        { territory_id: 'c', name: 'C', polygon: [], center_point: [2, 0], region_id: 'r' },
      ],
      connections: [
        { from: 'a', to: 'b', type: 'land' },
        { from: 'b', to: 'c', type: 'land' },
      ],
      regions: [{ region_id: 'r', name: 'Region', bonus: 0 }],
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

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
  }

  type Redeemed = { bonus: number; playerId?: string };

  /**
   * A fresh id per run. An AI turn keeps playing after the test has what it
   * needs, holding the per-game Redis lock; a fixed id would let a previous
   * run's still-held lock block this run's hand-off.
   */
  const freshGameId = (label: string) => `itest-cards-${label}-${process.pid}-${Date.now()}`;

  // ── Tests ──────────────────────────────────────────────────────────────────

  it("names the AI when its turn redeems a set, so the human's client can tell it is not theirs", async () => {
    const gameId = freshGameId('ai');
    const state = buildState(gameId, { phase: 'fortify' });
    state.players[1].cards = infantrySet('ai');
    await seed(gameId, state);

    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    // The room-wide broadcast lands on the human's socket; the AI turn is
    // scheduled 1.5s after the hand-off and redeems at the top of its draft.
    const redeemed = waitFor<Redeemed>(client, 'game:cards_redeemed', 25_000);
    client.emit('game:advance_phase', { gameId });

    const payload = await redeemed;
    expect(payload.playerId).toBe(AI);
    expect(payload.bonus).toBeGreaterThan(0);
  }, 40_000);

  it('names the human on their own redemption', async () => {
    const gameId = freshGameId('human');
    const state = buildState(gameId, { phase: 'draft', draft_units_remaining: 3 });
    state.players[0].cards = infantrySet('h');
    await seed(gameId, state);

    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const redeemed = waitFor<Redeemed>(client, 'game:cards_redeemed', 10_000);
    client.emit('game:redeem_cards', { gameId, cardIds: ['h-a', 'h-b', 'h-c'] });

    const payload = await redeemed;
    expect(payload.playerId).toBe(HUMAN);
    expect(payload.bonus).toBeGreaterThan(0);
  }, 20_000);
});

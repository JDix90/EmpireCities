/**
 * A daily objective day ended by conquest, through the real attack handler to
 * `game:over`: what the run settles as, and what the game pays out for it.
 *
 * Taking the last rival's last territory ends the game on the victory check,
 * which the puzzle resolver never sees through: a capture waits for the AI's
 * reply, and there is no AI left to reply. `finalizeGame` settles the day on
 * the final board, then pays the result out — a conquest that left the target
 * held is a win, one that beat the objective to the finish is a loss, and
 * XP (via `recordGameResults`) and the win streak follow the challenge.
 *
 * Redis-gated like the other socket integration tests. Locally:
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/dailyConquestSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  paidWinners: [] as string[][],
  streaks: [] as Array<{ userId: string; won: boolean }>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));

// Postgres is incidental except where finalizeGame reads or writes the daily
// run: the `games` status transition must succeed (rowCount 1) or finalize
// bails as a duplicate, the daily-date lookup must name a day, and the entry
// INSERT is captured to read its `won` column.
vi.mock('../db/postgres', () => {
  const poolResult = { rows: [] as unknown[], rowCount: 1 };
  const client = { query: async () => ({ rows: [] as unknown[], rowCount: 0 }), release: () => {} };
  return {
    query: async (sql: string, params: unknown[] = []) => {
      spies.queries.push({ sql, params });
      return [];
    },
    queryOne: async (sql: string) =>
      sql.includes("settings_json->>'daily_challenge_date' AS daily_challenge_date FROM games")
        ? { daily_challenge_date: '2026-09-24' }
        : null,
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
    recordGameResults: async (_gameId: string, _state: unknown, winnerIds: string[]) => {
      spies.paidWinners.push([...winnerIds]);
      return { ratingDeltas: new Map(), ratingProvisional: new Map(), guestPlayerIds: new Set(), isRanked: false, xpEarnedByPlayer: {} };
    },
  };
});

vi.mock('../game-engine/progression/progressionService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../game-engine/progression/progressionService')>();
  return {
    ...mod,
    applyWinStreak: async (_client: unknown, userId: string, opts: { won: boolean }) => {
      spies.streaks.push({ userId, won: opts.won });
      return 0;
    },
  };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('daily objective day ended by conquest (socket integration)', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
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
    getGameState = store.getGameState;
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
    spies.paidWinners.length = 0;
    spies.streaks.length = 0;
    spies.queries.length = 0;
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  const HUMAN = 'p1';
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

  function spec(extra: Partial<DailyPuzzleSpec>): DailyPuzzleSpec {
    return {
      archetype: 'military_capture',
      title: 'Trace Italienne', intro: 'i', goal: 'g',
      era_id: 'medieval', map_id: 'm', seed: 1, player_count: 2, max_turns: 8, dice_queue_seed: 1,
      ...extra,
    } as DailyPuzzleSpec;
  }

  /**
   * Turn 1 of a two-seat daily: the human on `a` (4 units) beside the AI's
   * only territory `b` (1 unit). Dice [6,6,6 | 1] take `b` in one exchange,
   * eliminating the AI; the trailing 1s keep any extra draw deterministic.
   */
  function buildState(gameId: string, day: DailyPuzzleSpec): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'attack',
      current_player_index: 0,
      turn_number: 1,
      players: [
        player(HUMAN, 0),
        player(AI, 1, { is_ai: true, ai_difficulty: 'medium' }),
      ],
      territories: { a: terr('a', HUMAN, 4), b: terr('b', AI, 1) },
      card_deck: [
        { card_id: 'd1', territory_id: 'a', symbol: 'infantry' },
        { card_id: 'd2', territory_id: 'b', symbol: 'cavalry' },
      ],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: {
        fog_of_war: false,
        allowed_victory_conditions: [],
        victory_type: 'domination',
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
        daily_challenge_date: '2026-09-24',
        daily_challenge_spec: day as unknown as Record<string, unknown>,
      },
      draft_units_remaining: 0,
      turn_started_at: 1_700_000_000_000,
      era_modifiers: {},
      puzzle_dice_queue: [6, 6, 6, 1, ...Array(8).fill(1)],
    } as unknown as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Daily Conquest Test',
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

  // ── Harness helpers ───────────────────────────────────────────────────────────

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

  type GameOver = { winner_ids: string[]; victory_condition: string; daily_result?: { won: boolean; outcome: string | null } };

  /** Seed the day, take `b` with the scripted dice, and return the game-over payload. */
  async function conquer(gameId: string, day: DailyPuzzleSpec): Promise<GameOver> {
    await setGameState(gameId, buildState(gameId, day));
    await setGameMap(gameId, buildMap(gameId));
    createdGames.push(gameId);
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const over = waitFor<GameOver>(client, 'game:over');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    return over;
  }

  function entryWon(): unknown {
    const insert = spies.queries.find((q) => q.sql.includes('INSERT INTO daily_challenge_entries'));
    expect(insert, 'the daily entry was written').toBeDefined();
    return insert!.params[2];
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('pays a conquest that beat the objective to the finish as a loss', async () => {
    // The reported day: research a tech; the only rival fell on turn 1 first.
    const over = await conquer('itest-daily-unmet', spec({ archetype: 'tech_research', tech_id: 'tech_star_forts' }));

    // The board is the human's; the challenge is not.
    expect(over.winner_ids).toEqual([HUMAN]);
    expect(over.victory_condition).toBe('last_standing');
    expect(over.daily_result).toEqual({ won: false, outcome: 'unmet' });
    expect(entryWon()).toBe(false);
    // XP, rank and rating are computed with nobody credited, and the streak breaks.
    expect(spies.paidWinners).toEqual([[]]);
    expect(spies.streaks).toEqual([{ userId: HUMAN, won: false }]);
  });

  it('pays a capture that took the last rival with it as a solved day', async () => {
    const gameId = 'itest-daily-capture';
    const over = await conquer(gameId, spec({ archetype: 'military_capture', target_territory_id: 'b' }));

    expect(over.daily_result).toEqual({ won: true, outcome: 'solved' });
    expect(entryWon()).toBe(true);
    expect(spies.paidWinners).toEqual([[HUMAN]]);
    expect(spies.streaks).toEqual([{ userId: HUMAN, won: true }]);
    // The settled objective is part of the saved result, not only the payout.
    const saved = await getGameState(gameId);
    expect(saved?.puzzle_objective_met).toBe(true);
  });

  it('reads a region day off the map when the conquest completes it', async () => {
    const over = await conquer('itest-daily-region', spec({ archetype: 'control_region', region_id: 'front' }));
    expect(over.daily_result).toEqual({ won: true, outcome: 'solved' });
    expect(spies.paidWinners).toEqual([[HUMAN]]);
  });
});

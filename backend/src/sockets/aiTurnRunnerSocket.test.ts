/**
 * A live bot turn runs through planAiTurn and playAiTurn
 * (game-engine/ai/runAiTurn.ts), the same turn the arena and the other
 * harnesses measure, at the seat's level shifted by its commander's style
 * (ai/aiStyles.ts styledLevel). Both are wrapped in spies that call through,
 * so the turn plays exactly as it would and the test reads what they were
 * given.
 *
 * Redis-gated like the other socket integration tests. Locally:
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/aiTurnRunnerSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// A no-op Postgres, as in aiTurnDigestSocket.test.ts.
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

vi.mock('../game-engine/ai/runAiTurn', async () => {
  const actual = await vi.importActual<typeof import('../game-engine/ai/runAiTurn')>('../game-engine/ai/runAiTurn');
  return { ...actual, planAiTurn: vi.fn(actual.planAiTurn), playAiTurn: vi.fn(actual.playAiTurn) };
});

import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';
import { planAiTurn, playAiTurn } from '../game-engine/ai/runAiTurn';
import { styledLevel, type AiStyle } from '../game-engine/ai/aiStyles';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('a live bot turn (socket integration)', () => {
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
    vi.mocked(planAiTurn).mockClear();
    vi.mocked(playAiTurn).mockClear();
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const HUMAN = 'runner_p1';
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

  /** a ─ b ─ c: the bot holds b between two of the human's tiles. */
  function buildState(gameId: string, style?: AiStyle): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'fortify',
      current_player_index: 0,
      turn_number: 3,
      players: [
        player(HUMAN, 0, { territory_count: 2 }),
        player(AI, 1, { is_ai: true, ai_difficulty: 'hard', ...(style ? { ai_style: style } : {}) }),
      ],
      territories: { a: terr('a', HUMAN, 6), b: terr('b', AI, 4), c: terr('c', HUMAN, 6) },
      card_deck: [],
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
    } as unknown as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Runner Test',
      era: 'medieval',
      territories: ['a', 'b', 'c'].map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: 'r',
      })),
      connections: [
        { from: 'a', to: 'b', type: 'land' },
        { from: 'b', to: 'c', type: 'land' },
      ],
      regions: [{ region_id: 'r', name: 'R', bonus: 1 }],
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

  /** The human ends their turn; resolves once the bot has played and handed it back. */
  async function playBotTurn(style?: AiStyle): Promise<void> {
    // A fresh id per run, so a lock still held by an earlier run's turn cannot block this one.
    const gameId = `itest-runner-${style ?? 'none'}-${process.pid}-${Date.now()}`;
    await setGameState(gameId, buildState(gameId, style));
    await setGameMap(gameId, buildMap(gameId));
    createdGames.push(gameId);
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    const back = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for the turn to come back')), 30_000);
      client.on('game:state', (s: GameState) => {
        if (s.game_id === gameId && s.turn_number > 3 && s.players[s.current_player_index]?.player_id === HUMAN) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    client.emit('game:advance_phase', { gameId });
    await back;
  }

  /** What the live turn handed the shared runner: the seat, its level, and the plan it played. */
  async function runnerCalls() {
    expect(planAiTurn).toHaveBeenCalledTimes(1);
    expect(playAiTurn).toHaveBeenCalledTimes(1);
    const [, , planSeat, planLevel] = vi.mocked(planAiTurn).mock.calls[0]!;
    const [, , playSeat, playLevel, plan, resumeAt] = vi.mocked(playAiTurn).mock.calls[0]!;
    return {
      planSeat: planSeat.player_id,
      playSeat: playSeat.player_id,
      planLevel,
      playLevel,
      plannedThenPlayed: plan === await vi.mocked(planAiTurn).mock.results[0]!.value,
      resumeAt,
    };
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('plans and plays the bot\'s turn through the shared runner, at its commander\'s styled level', async () => {
    await playBotTurn('conqueror');
    const calls = await runnerCalls();
    const styled = styledLevel('hard', 'conqueror');
    // The style shifts the level: a profile, not the plain difficulty.
    expect(styled).not.toBe('hard');
    expect(calls).toEqual({
      planSeat: AI,
      playSeat: AI,
      planLevel: styled,
      playLevel: styled,
      plannedThenPlayed: true,
      resumeAt: 'draft',
    });
  }, 45_000);

  it('plays a bot without a commander at its own level', async () => {
    await playBotTurn();
    expect(await runnerCalls()).toEqual({
      planSeat: AI,
      playSeat: AI,
      planLevel: 'hard',
      playLevel: 'hard',
      plannedThenPlayed: true,
      resumeAt: 'draft',
    });
  }, 45_000);
});

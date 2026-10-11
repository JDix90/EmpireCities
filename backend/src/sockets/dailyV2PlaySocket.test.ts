/**
 * A graded (v2) daily day through the real socket handlers: the verdict a
 * proposal gets, the commit that records the decision, and the attack that
 * grades itself, with the day's solver in its worker thread (puzzleGrader.ts)
 * as the server runs it. The handlers wait on each grade while they hold the
 * game's lock; what reaches Redis is the graded state.
 *
 * Redis-gated like the other socket integration tests. Locally:
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/dailyV2PlaySocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres is incidental here: the debounced backups and stat writes go nowhere.
vi.mock('../db/postgres', () => {
  const client = { query: async () => ({ rows: [] as unknown[], rowCount: 0 }), release: () => {} };
  return {
    query: async () => [],
    queryOne: async () => null,
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: {
      query: async () => ({ rows: [] as unknown[], rowCount: 0 }),
      connect: async () => client,
      end: async () => {},
      on: () => {},
      waitingCount: 0,
      totalCount: 0,
      idleCount: 0,
    },
  };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { EraId, GameMap, GameSettings, GameState, PlayerState } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { scheduleDayV2 } from '../game-engine/daily/dailyScheduleV2';
import { buildGameSettingsFromChallenge } from '../game-engine/daily/dailySettings';
import { applyDailyPuzzleScenario } from '../game-engine/daily/applyDailyPuzzleScenario';
import { initializeGameState } from '../game-engine/state/gameStateManager';
import { contextFromSpec } from '../game-engine/daily/puzzle/bridge';
import { LocalGrader, ThreadGrader } from '../game-engine/daily/puzzleGrader';
import {
  commitPuzzleAttack,
  getWarmedPuzzle,
  puzzleCacheKey,
  resetWarmedPuzzlesForTests,
  warmPuzzle,
  type PuzzleVerdict,
  type WarmedPuzzle,
} from '../game-engine/daily/puzzlePlay';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('daily v2 play over the socket (socket integration)', () => {
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

  // savannah, 27 October: an opening that is a decision (stop attacking, or
  // assault the Carolinas), solved in milliseconds.
  const DATE = '2026-10-27';
  let spec: DailyPuzzleSpec;
  let map: GameMap;

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

    const readMap = (mapId: string): GameMap =>
      JSON.parse(readFileSync(join(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
    const day = await scheduleDayV2(DATE, { loadMap: async (mapId) => readMap(mapId), simulate: null });
    if (!day?.spec.v2) throw new Error(`${DATE} is not a graded day`);
    spec = day.spec;
    map = readMap(spec.map_id);

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    resetWarmedPuzzlesForTests();
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  // This file's own: a human's game:state goes to their user room, which the
  // Redis adapter shares with every socket test file on the same Redis.
  const HUMAN = 'dailyv2_p1';
  const AI = 'ai_1';

  /** The day's opening as the server deals it when the game starts. */
  function openingState(gameId: string): GameState {
    const settings = buildGameSettingsFromChallenge({ challenge_date: DATE, seed: spec.seed, player_count: spec.player_count, spec });
    const seats = [
      { player_id: HUMAN, player_index: 0, username: 'DAILYV2_P1', color: '#c0392b', is_ai: false, is_eliminated: false, mmr: 1000 },
      { player_id: AI, player_index: 1, username: 'Bot', color: '#2980b9', is_ai: true, ai_difficulty: 'medium', is_eliminated: false, mmr: 1000 },
    ] as Array<Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>>;
    const state = initializeGameState(gameId, spec.era_id as EraId, map, seats, settings as unknown as GameSettings);
    applyDailyPuzzleScenario(state, map, spec, HUMAN, AI);
    return state;
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

  /** Seed the opening, warm the day's grader as a game's start does, and connect the human. */
  async function start(gameId: string): Promise<{ client: ClientSocket; opening: GameState }> {
    const opening = openingState(gameId);
    await setGameState(gameId, opening);
    await setGameMap(gameId, map);
    createdGames.push(gameId);
    expect(await warmPuzzle(spec, map), 'the day warms').toBeGreaterThan(0);
    const client = await connect(HUMAN);
    await joinRoom(HUMAN, gameId);
    return { client, opening };
  }

  function propose(client: ClientSocket, gameId: string, proposal: unknown): Promise<PuzzleVerdict> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for game:puzzle_verdict')), 10_000);
      client.once('game:puzzle_verdict', (verdict: PuzzleVerdict) => { clearTimeout(t); resolve(verdict); });
      client.emit('game:puzzle_propose', { gameId, proposal });
    });
  }

  /** The saved state once `done` holds (the handler persists when it is through). */
  async function savedWhen(gameId: string, done: (s: GameState) => boolean): Promise<GameState> {
    for (let i = 0; i < 200; i++) {
      const s = await getGameState(gameId);
      if (s && done(s)) return s;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${gameId}: the state never settled`);
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('answers a proposal from the worker thread, and the commit records that decision', async () => {
    const gameId = 'itest-dailyv2-stop';
    const { client } = await start(gameId);
    expect(getWarmedPuzzle(spec, map)?.grader).toBeInstanceOf(ThreadGrader);

    // Stopping is the best move at this opening.
    const verdict = await propose(client, gameId, { kind: 'end_attack' });
    expect(verdict).toMatchObject({ decision: true, silent: false, grade: 'best', loss: 0, takebacks: 0 });

    client.emit('game:advance_phase', { gameId, action_id: 'itest-dailyv2-stop-1' });
    const saved = await savedWhen(gameId, (s) => s.phase === 'fortify');
    expect(saved.puzzle_decisions).toHaveLength(1);
    expect(saved.puzzle_decisions![0]).toMatchObject({
      phase: 'attack',
      best: { kind: 'end_attack' },
      first: { kind: 'end_attack' },
      chosen: { kind: 'end_attack' },
      chosen_loss: 0,
      grade: 'best',
      takebacks: 0,
    });
  });

  it('counts a takeback over the socket: the first proposal is what the decision records', async () => {
    const gameId = 'itest-dailyv2-takeback';
    const { client } = await start(gameId);
    const ctx = contextFromSpec(spec, map);
    const assault = { kind: 'attack', from: 'acw_georgia_fl', to: 'acw_carolinas' } as const;
    expect(ctx.index.has(assault.from) && ctx.index.has(assault.to), 'the day still opens on this edge').toBe(true);

    const first = await propose(client, gameId, assault);
    expect(first.decision).toBe(true);
    expect(first.loss).toBeGreaterThanOrEqual(5);
    const second = await propose(client, gameId, { kind: 'end_attack' });
    expect(second).toMatchObject({ decision: true, grade: 'best', takebacks: 1 });

    client.emit('game:advance_phase', { gameId, action_id: 'itest-dailyv2-takeback-1' });
    const saved = await savedWhen(gameId, (s) => s.phase === 'fortify');
    expect(saved.puzzle_takebacks).toBe(1);
    expect(saved.puzzle_decisions).toHaveLength(1);
    expect(saved.puzzle_decisions![0]).toMatchObject({
      first: { kind: 'assault', from: assault.from, to: assault.to, keep: 1 },
      loss: first.loss,
      takebacks: 1,
      chosen: { kind: 'end_attack' },
      chosen_loss: 0,
    });
  });

  it('grades an attack nobody proposed before its dice, as puzzlePlay does on this thread', async () => {
    const gameId = 'itest-dailyv2-attack';
    const { client, opening } = await start(gameId);
    const from = 'acw_georgia_fl';
    const to = 'acw_carolinas';

    // What the commit records, graded on this thread from the same opening.
    const ctx = contextFromSpec(spec, map);
    const here: WarmedPuzzle = { key: puzzleCacheKey(spec), spec, ctx, grader: new LocalGrader(spec, ctx) };
    const expected = structuredClone(opening);
    await commitPuzzleAttack(here, expected, from, to);
    expect(expected.puzzle_decisions?.length, 'the attack is a graded decision').toBeGreaterThan(0);

    client.emit('game:attack', { gameId, fromId: from, toId: to });
    const saved = await savedWhen(gameId, (s) => s.puzzle_assault_edge === `1:${from}>${to}`);
    expect(saved.puzzle_decisions).toEqual(expected.puzzle_decisions);
    expect(saved.puzzle_decisions!.at(-1)!.chosen).toEqual({ kind: 'assault', from, to, keep: 1 });
  });
});

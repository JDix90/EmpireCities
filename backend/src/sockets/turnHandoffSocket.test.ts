/**
 * Turn hand-off paths through the real socket server and a real Redis room:
 * the real-time turn clock, event cards across hand-offs, AI turns around game
 * over, and choice cards on away seats.
 *
 * Redis-gated like the rest of the Redis tier. It starts the BullMQ turn-timer
 * worker, so run it on a Redis no other suite is scheduling turn timers on:
 *   redis-server --port 6399 --save '' --appendonly no --requirepass chronoredis --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/turnHandoffSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres is incidental here, as in gameAttackSocket.test.ts, except that the
// timer processor looks its game up before acting: answer "in progress".
vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async () => [],
    queryOne: async (sql: string, params: unknown[] = []) =>
      sql.includes('SELECT map_id, status FROM games')
        ? { map_id: params[0], status: 'in_progress' }
        : null,
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

describe.runIf(redisTestEnabled)('turn hand-off socket integration', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let timer: typeof import('../workers/gameTimerWorker');

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
    timer = await import('../workers/gameTimerWorker');

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
    timer.startTurnTimerWorker();
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    // Closes the socket.io server, its Redis adapter and the BullMQ worker.
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    const ids = createdGames.splice(0);
    // Drop any clock a test left armed so it cannot fire into a later test.
    const jobs = await timer.turnTimerQueue.getJobs(['delayed', 'waiting']).catch(() => []);
    await Promise.all(jobs
      .filter((j) => j && ids.includes(j.data.gameId))
      .map((j) => j.remove().catch(() => {})));
    for (const id of ids) await deleteGameKeys(id).catch(() => {});
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

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
   * One territory per seat and no connections: nobody can attack, so an AI turn
   * only drafts, and every unit count below is exact.
   */
  function isolatedMap(gameId: string, ids: string[]): GameMap {
    return {
      map_id: gameId,
      name: 'Hand-off Test',
      era: 'medieval',
      territories: ids.map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: `r_${id}`,
      })),
      connections: [],
      regions: ids.map((id) => ({ region_id: `r_${id}`, name: id, bonus: 0 })),
    } as unknown as GameMap;
  }

  function buildState(gameId: string, overrides: Partial<GameState>): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'draft',
      current_player_index: 0,
      turn_number: 3,
      players: [player('p1', 0), player('p2', 1)],
      territories: { a: terr('a', 'p1', 3), b: terr('b', 'p2', 3) },
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
      turn_started_at: Date.now(),
      era_modifiers: {},
      ...overrides,
    } as GameState;
  }

  // ── Harness helpers ───────────────────────────────────────────────────────────

  async function seed(gameId: string, state: GameState, map: GameMap): Promise<void> {
    await setGameState(gameId, state);
    await setGameMap(gameId, map);
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

  /** Join the server-side socket to the game room so it receives io.to(gameId) broadcasts. */
  async function joinRoom(userId: string, gameId: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) { s.join(gameId); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Poll Redis until the persisted state matches, or give up after `timeoutMs`. */
  async function waitForRedisState(
    gameId: string,
    predicate: (s: GameState) => boolean,
    timeoutMs = 5_000,
  ): Promise<GameState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = await getGameState(gameId);
      if (s && predicate(s)) return s;
      if (Date.now() > deadline) throw new Error('timed out waiting for persisted Redis state');
      await sleep(20);
    }
  }

  // ── The real-time turn clock ────────────────────────────────────────────────

  describe('real-time turn clock', () => {
    it('keeps timing out an idle seat, phase after phase, into the next turn', async () => {
      const gameId = 'handoff-clock-chain';
      await seed(gameId, buildState(gameId, {
        draft_units_remaining: 3,
        settings: { ...buildState(gameId, {}).settings, turn_timer_seconds: 1 },
      }), isolatedMap(gameId, ['a', 'b']));
      const p1 = await connect('p1');
      await joinRoom('p1', gameId);

      // Ending the draft arms p1's attack clock; then nobody acts again. Each
      // expiry arms the next clock from inside the timer's own job.
      p1.emit('game:advance_phase', { gameId });
      await waitForRedisState(gameId, (s) => s.phase === 'attack');

      const seen: string[] = [];
      const record = (s: GameState) => {
        const key = `${s.current_player_index}:${s.phase}`;
        if (seen[seen.length - 1] !== key) seen.push(key);
        return s.current_player_index === 1 && s.phase === 'attack';
      };
      await waitForRedisState(gameId, record, 10_000).catch(() => undefined);
      expect(seen).toEqual(['0:attack', '0:fortify', '1:draft', '1:attack']);
    }, 20_000);

    it('ignores a timeout that fired while the player\'s own end-turn held the lock', async () => {
      const gameId = 'handoff-clock-stale';
      const p1Deadline = Date.now() + 150;
      await seed(gameId, buildState(gameId, {
        phase: 'fortify',
        phase_deadline_at: p1Deadline,
        settings: { ...buildState(gameId, {}).settings, turn_timer_seconds: 60 },
      }), isolatedMap(gameId, ['a', 'b']));
      await timer.scheduleTurnTimeout(gameId, p1Deadline);

      // Stand-in for p1's end turn holding the room lock at the moment p1's
      // clock fires: once the timeout job is running (and so cannot be
      // removed), hand the turn to p2 and arm p2's clock the way
      // game:advance_phase → startTurnTimer does.
      const { runWithGameLock } = await import('./gameLock');
      const { advanceToNextPlayer } = await import('../game-engine/state/gameStateManager');
      let p2Deadline = 0;
      await runWithGameLock(gameId, async () => {
        for (let i = 0; i < 40; i++) {
          const job = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, p1Deadline));
          if (job && (await job.getState()) === 'active') break;
          await sleep(10);
        }
        const s = (await getGameState(gameId))!;
        advanceToNextPlayer(s, isolatedMap(gameId, ['a', 'b']));
        p2Deadline = Date.now() + 60_000;
        s.phase_deadline_at = p2Deadline;
        await setGameState(gameId, s);
        await timer.scheduleTurnTimeout(gameId, p2Deadline);
      });

      await sleep(1_000); // the stale job has had the lock and finished
      const s = (await getGameState(gameId))!;
      const p2Job = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, p2Deadline));
      expect({
        seat: s.current_player_index,
        phase: s.phase,
        draftLeft: s.draft_units_remaining,
        p2Clock: p2Job ? await p2Job.getState() : 'none',
      }).toEqual({ seat: 1, phase: 'draft', draftLeft: 3, p2Clock: 'delayed' });
    }, 20_000);
  });
});

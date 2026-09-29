/**
 * Turn hand-off paths through the real socket server and a real Redis room:
 * the real-time turn clock, Territory Draft clocks (real time and async),
 * event cards across hand-offs, AI turns around game over, resigning, wins
 * that must not wait for a hand-off, and choice cards on away seats.
 *
 * Redis-gated like the rest of the Redis tier. It starts the BullMQ turn-timer
 * and async-deadline workers, so run it on a Redis no other suite is
 * scheduling either on:
 *   redis-server --port 6399 --save '' --appendonly no --requirepass chronoredis --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/turnHandoffSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres is incidental here, as in gameAttackSocket.test.ts, except that the
// timer processor looks its game up before acting (answer "in progress") and
// the game-over tests read which pool writes were attempted.
const pg = vi.hoisted(() => ({ poolCalls: [] as string[] }));
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
      query: async (sql: string) => { pg.poolCalls.push(sql); return result; },
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
import type { GameState, GameMap, PlayerState, TerritoryState, EventCard } from '../types';

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
  let asyncWorker: typeof import('../workers/asyncDeadlineWorker');

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
    asyncWorker = await import('../workers/asyncDeadlineWorker');
    asyncWorker.startAsyncDeadlineWorker();
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
    const asyncJobs = await asyncWorker.asyncDeadlineQueue.getJobs(['delayed', 'waiting']).catch(() => []);
    await Promise.all(asyncJobs
      .filter((j) => j && ids.includes(j.data.gameId))
      .map((j) => j.remove().catch(() => {})));
    for (const id of ids) await deleteGameKeys(id).catch(() => {});
    pg.poolCalls.length = 0;
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  // Tests with bots seat their own player ids: game:state goes to per-user
  // rooms, and a bot turn a test left queued can still broadcast after it ends.
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

  /** joinRoom, and record the player as at the table, as game:join does. */
  async function joinRoomPresent(userId: string, gameId: string): Promise<void> {
    await joinRoom(userId, gameId);
    const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId)!;
    const { onPlayerConnected } = await import('./gameRoomManager');
    await onPlayerConnected(gameId, s.id, userId);
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

    it('lands the incoming player\'s Drop Assault when a fortify timeout hands them the turn', async () => {
      const gameId = 'handoff-clock-drop';
      const p1Deadline = Date.now() + 150;
      await seed(gameId, buildState(gameId, {
        phase: 'fortify',
        turn_number: 4,
        phase_deadline_at: p1Deadline,
        settings: { ...buildState(gameId, {}).settings, turn_timer_seconds: 60 },
        // p2 declared a drop on p1's tile last round: it resolves as p2's turn
        // begins, the way every other hand-off resolves it (landed, or called
        // off here, since p2 holds no lunar foothold).
        drop_assaults: [{ owner_id: 'p2', target_id: 'a', declared_turn: 3, units: 3 }],
      }), isolatedMap(gameId, ['a', 'b']));
      await timer.scheduleTurnTimeout(gameId, p1Deadline); // p1's fortify clock runs out

      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 1);
      expect(s.drop_assaults ?? []).toEqual([]);
    }, 20_000);
  });

  // ── Territory Draft clocks ──────────────────────────────────────────────────

  describe('Territory Draft clocks', () => {
    /** Two seats drafting four one-tile regions; `owners` pre-claims some. */
    function draftState(
      gameId: string,
      settings: Partial<GameState['settings']>,
      over: Partial<GameState> = {},
      owners: Record<string, string> = {},
    ): GameState {
      const seats = [`${gameId}-1`, `${gameId}-2`];
      const tiles = ['a', 'b', 'c', 'd'];
      return buildState(gameId, {
        phase: 'territory_select',
        turn_number: 1,
        players: seats.map((id, i) => player(id, i, {
          territory_count: tiles.filter((t) => owners[t] === id).length,
        })),
        territories: Object.fromEntries(tiles.map((t) => [t, terr(t, owners[t] ?? null, owners[t] ? 3 : 0)])),
        settings: { ...buildState(gameId, {}).settings, territory_selection: true, ...settings },
        ...over,
      });
    }

    const ASYNC_DAY = { turn_timer_seconds: 86400, async_mode: true, async_turn_deadline_seconds: 86400 };

    it('a real-time pick that times out is made for the seat, and the draft goes on', async () => {
      const gameId = 'handoff-draft-clock';
      const deadline = Date.now() + 150;
      await seed(gameId, draftState(gameId, { turn_timer_seconds: 60 }, { phase_deadline_at: deadline }),
        isolatedMap(gameId, ['a', 'b', 'c', 'd']));
      await timer.scheduleTurnTimeout(gameId, deadline);

      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 1);
      expect({
        phase: s.phase,
        picked: Object.values(s.territories).filter((t) => t.owner_id === `${gameId}-1`).map((t) => t.unit_count),
        unclaimed: Object.values(s.territories).filter((t) => !t.owner_id).length,
      }).toEqual({ phase: 'territory_select', picked: [3], unclaimed: 3 });
    }, 20_000);

    it('an async pick whose deadline lapses is made for the seat, and the next pick gets its day', async () => {
      const gameId = 'handoff-draft-async';
      await seed(gameId, draftState(gameId, ASYNC_DAY), isolatedMap(gameId, ['a', 'b', 'c', 'd']));
      await asyncWorker.scheduleAsyncDeadline(gameId, 1, 0, 0); // seat 0's day is up

      // The next seat's clock is persisted just after the pick is saved.
      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 1 && st.phase_deadline_at != null);
      expect({
        phase: s.phase,
        picked: Object.values(s.territories).filter((t) => t.owner_id === `${gameId}-1`).map((t) => t.unit_count),
        unclaimed: Object.values(s.territories).filter((t) => !t.owner_id).length,
        nextPickHasADay: (s.phase_deadline_at ?? 0) - Date.now() > 23 * 3600_000,
      }).toEqual({ phase: 'territory_select', picked: [3], unclaimed: 3, nextPickHasADay: true });
    }, 20_000);

    it('an async lapse on the last pick ends the draft with every territory claimed', async () => {
      const gameId = 'handoff-draft-async-last';
      const [s1, s2] = [`${gameId}-1`, `${gameId}-2`];
      await seed(gameId, draftState(gameId, ASYNC_DAY, { current_player_index: 1 }, { a: s1, b: s2, c: s1 }),
        isolatedMap(gameId, ['a', 'b', 'c', 'd']));
      await asyncWorker.scheduleAsyncDeadline(gameId, 1, 1, 0); // seat 1's day is up

      const s = await waitForRedisState(gameId, (st) => st.phase !== 'territory_select');
      expect({
        phase: s.phase,
        turn: s.turn_number,
        board: Object.values(s.territories).map((t) => [t.territory_id, t.owner_id, t.unit_count]),
      }).toEqual({
        phase: 'draft',
        turn: 1,
        board: [['a', s1, 3], ['b', s2, 3], ['c', s1, 3], ['d', s2, 3]],
      });
    }, 20_000);
  });

  // ── Event cards across hand-offs ─────────────────────────────────────────────

  describe('event cards across hand-offs', () => {
    /** +5 on the human's own tile: whoever's turn applies it, each application shows. */
    function levyOn(tileId: string, extra: Partial<EventCard> = {}): EventCard {
      return {
        card_id: `levy_${tileId}`,
        title: 'Levy',
        description: `+5 units on ${tileId}`,
        category: 'global',
        era_id: 'custom',
        effect: { type: 'units_added', target: 'territory', target_id: tileId, value: 5 },
        ...extra,
      } as EventCard;
    }

    // 'custom' has no era deck, so the only cards in play are the test's own.
    const eventSettings = {
      fog_of_war: false,
      allowed_victory_conditions: ['domination'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      events_enabled: true,
      event_impact_scaling_enabled: false,
    } as GameState['settings'];

    it('applies a card once when bots hand the turn to bots', async () => {
      const gameId = 'handoff-event-bots';
      const card = levyOn('h1');
      await seed(gameId, buildState(gameId, {
        era: 'custom' as GameState['era'],
        phase: 'fortify',
        turn_number: 2,
        players: [
          player('bots-h', 0),
          player('bots-a1', 1, { is_ai: true, ai_difficulty: 'easy' }),
          player('bots-a2', 2, { is_ai: true, ai_difficulty: 'easy' }),
          player('bots-a3', 3, { is_ai: true, ai_difficulty: 'easy' }),
        ],
        territories: {
          h1: terr('h1', 'bots-h', 3), t1: terr('t1', 'bots-a1', 3), t2: terr('t2', 'bots-a2', 3), t3: terr('t3', 'bots-a3', 3),
        },
        settings: eventSettings,
        seasonal_event_cards: [],
        // This round's card goes to a2, at the start of a2's own turn.
        pending_event: { card, target_player_id: 'bots-a2' },
      }), isolatedMap(gameId, ['h1', 't1', 't2', 't3']));
      const h = await connect('bots-h');
      await joinRoom('bots-h', gameId);
      const shown: string[] = [];
      h.on('game:event_card', (c: EventCard) => shown.push(c.card_id));

      // h ends the turn; a1, a2 and a3 play; the turn comes back to h.
      h.emit('game:advance_phase', { gameId });
      const s = await waitForRedisState(gameId, (st) => st.turn_number === 3 && st.current_player_index === 0, 15_000);
      expect({ h1: s.territories.h1.unit_count, shown: shown.filter((id) => id === card.card_id).length })
        .toEqual({ h1: 8, shown: 1 });
      expect(s.active_event).toBeUndefined();
    }, 30_000);

    it('applies a card once when a bot hands the turn to a human with no turn timer', async () => {
      const gameId = 'handoff-event-solo';
      // Hits every player at the start of each round; the round opens on h.
      const card = levyOn('h1', { affects_all_players: true });
      await seed(gameId, buildState(gameId, {
        era: 'custom' as GameState['era'],
        phase: 'fortify',
        turn_number: 2,
        players: [player('solo-h', 0), player('solo-a1', 1, { is_ai: true, ai_difficulty: 'easy' })],
        territories: { h1: terr('h1', 'solo-h', 3), t1: terr('t1', 'solo-a1', 3) },
        settings: eventSettings,
        seasonal_event_cards: [card],
      }), isolatedMap(gameId, ['h1', 't1']));
      const h = await connect('solo-h');
      await joinRoom('solo-h', gameId);
      const shown: string[] = [];
      h.on('game:event_card', (c: EventCard) => shown.push(c.card_id));

      // h ends the turn; a1 plays; round 3 opens on h with the card.
      h.emit('game:advance_phase', { gameId });
      const opened = await waitForRedisState(gameId, (st) => st.turn_number === 3 && st.current_player_index === 0, 15_000);
      // Applied at the hand-off and retired before the save: an untimed human
      // turn writes nothing until h acts, so this is the state h's turn reloads.
      expect(opened.territories.h1.unit_count).toBe(3 + 5);
      expect(opened.active_event).toBeUndefined();
      // h plays an ordinary turn — draft (3 units, auto-placed on h1), attack,
      // fortify — and ends it. a1's next turn is 1.5s away, so the board read
      // below is the hand-off's alone.
      for (const expected of ['attack', 'fortify'] as const) {
        h.emit('game:advance_phase', { gameId });
        await waitForRedisState(gameId, (st) => st.phase === expected);
      }
      h.emit('game:advance_phase', { gameId });
      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 1);
      expect({ h1: s.territories.h1.unit_count, shown: shown.filter((id) => id === card.card_id).length })
        .toEqual({ h1: 3 + 5 + 3, shown: 1 });
    }, 30_000);
  });

  // ── AI turns around game over ─────────────────────────────────────────────────

  describe('AI turns around game over', () => {
    it('a bot turn queued before the last human resigns does not play the finished game', async () => {
      const gameId = 'handoff-resign-bot';
      await seed(gameId, buildState(gameId, {
        phase: 'fortify',
        turn_number: 1, // inside the resign grace window: the game is abandoned, no stats
        players: [player('over-h', 0), player('over-a1', 1, { is_ai: true, ai_difficulty: 'easy' })],
        territories: { h1: terr('h1', 'over-h', 3), t1: terr('t1', 'over-a1', 3) },
      }), isolatedMap(gameId, ['h1', 't1']));
      const h = await connect('over-h');
      await joinRoom('over-h', gameId);

      // End the turn (the bot's turn is queued 1.5s out), then resign in that gap.
      h.emit('game:advance_phase', { gameId });
      await waitForRedisState(gameId, (s) => s.current_player_index === 1);
      const over = new Promise<{ victory_condition: string }>((resolve) => h.once('game:over', resolve));
      h.emit('game:resign', { gameId });
      expect((await over).victory_condition).toBe('abandoned');

      const statesAfter: string[] = [];
      const oversAfter: string[] = [];
      h.on('game:state', (s: GameState) => statesAfter.push(s.phase));
      h.on('game:over', (o: { victory_condition: string }) => oversAfter.push(o.victory_condition));
      await sleep(3_500); // past the queued turn and any turn it would have played

      const s = (await getGameState(gameId))!;
      expect({
        livePhasesAfterOver: statesAfter.filter((p) => p !== 'game_over'),
        secondGameOver: oversAfter,
        persisted: [s.phase, s.victory_condition],
        finalizeAttempts: pg.poolCalls.filter((sql) => sql.includes("SET status = 'completed'")).length,
      }).toEqual({
        livePhasesAfterOver: [],
        secondGameOver: [],
        persisted: ['game_over', 'abandoned'],
        finalizeAttempts: 0,
      });
    }, 20_000);
  });

  // ── Resigning ───────────────────────────────────────────────────────────────────

  describe('resigning', () => {
    it('in the Territory Draft passes the pick, and the draft goes on to its end', async () => {
      const gameId = 'handoff-resign-pick';
      await seed(gameId, buildState(gameId, {
        phase: 'territory_select',
        turn_number: 1,
        players: [player('pick-a', 0), player('pick-b', 1), player('pick-c', 2)],
        territories: {
          a: terr('a', 'pick-a', 3), b: terr('b', 'pick-b', 3), c: terr('c', 'pick-c', 3), d: terr('d', null, 0),
        },
        settings: { ...buildState(gameId, {}).settings, territory_selection: true },
      }), isolatedMap(gameId, ['a', 'b', 'c', 'd']));
      const a = await connect('pick-a');
      await joinRoom('pick-a', gameId);
      const b = await connect('pick-b');
      await joinRoom('pick-b', gameId);
      const c = await connect('pick-c');
      await joinRoom('pick-c', gameId);

      a.emit('game:resign', { gameId });
      const passed = await waitForRedisState(gameId, (s) => s.players[0]!.is_eliminated);
      // b picks next, and a's tile is back in the pool.
      expect({ phase: passed.phase, seat: passed.current_player_index, a: passed.territories.a.owner_id })
        .toEqual({ phase: 'territory_select', seat: 1, a: null });

      b.emit('game:select_territory', { gameId, territoryId: 'a' });
      await waitForRedisState(gameId, (s) => s.current_player_index === 2);
      c.emit('game:select_territory', { gameId, territoryId: 'd' });
      const s = await waitForRedisState(gameId, (st) => st.phase !== 'territory_select');
      // The last claim ends the draft the normal way: turn one opens on a
      // board where every tile has an owner and a garrison.
      expect({
        phase: s.phase,
        turn: s.turn_number,
        a: [s.territories.a.owner_id, s.territories.a.unit_count],
        d: [s.territories.d.owner_id, s.territories.d.unit_count],
      }).toEqual({ phase: 'draft', turn: 1, a: ['pick-b', 3], d: ['pick-c', 3] });
    }, 20_000);

    it('hands the next player a fresh clock, and the resigner\'s never fires on it', async () => {
      const gameId = 'handoff-resign-clock';
      const aDeadline = Date.now() + 1_000; // a had a second left of a 60s clock
      await seed(gameId, buildState(gameId, {
        phase: 'attack',
        turn_number: 4, // past the resign grace window: the game goes on
        players: [player('rclock-a', 0), player('rclock-b', 1), player('rclock-c', 2)],
        territories: { a1: terr('a1', 'rclock-a', 3), b1: terr('b1', 'rclock-b', 3), c1: terr('c1', 'rclock-c', 3) },
        settings: { ...buildState(gameId, {}).settings, turn_timer_seconds: 60 },
        phase_deadline_at: aDeadline,
      }), isolatedMap(gameId, ['a1', 'b1', 'c1']));
      await timer.scheduleTurnTimeout(gameId, aDeadline); // a's clock, still running
      const a = await connect('rclock-a');
      await joinRoom('rclock-a', gameId);

      a.emit('game:resign', { gameId });
      const handed = await waitForRedisState(gameId, (s) => s.current_player_index === 1);
      await sleep(1_500); // past a's deadline
      const s = (await getGameState(gameId))!;
      const aJob = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, aDeadline));
      const bJob = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, s.phase_deadline_at ?? 0));
      // b's draft is untouched and runs on b's own 60s clock.
      expect({
        phase: s.phase,
        draftLeft: s.draft_units_remaining,
        freshClock: (s.phase_deadline_at ?? 0) - aDeadline > 50_000,
        aClock: aJob ? await aJob.getState() : 'none',
        bClock: bJob ? await bJob.getState() : 'none',
      }).toEqual({
        phase: 'draft',
        draftLeft: handed.draft_units_remaining,
        freshClock: true,
        aClock: 'none',
        bClock: 'delayed',
      });
    }, 20_000);

    it('leaves the resigner\'s land to be fought over, on a classic board too', async () => {
      const gameId = 'handoff-resign-land';
      await seed(gameId, buildState(gameId, {
        phase: 'attack',
        turn_number: 4,
        players: [player('land-a', 0), player('land-b', 1), player('land-c', 2)],
        territories: { a1: terr('a1', 'land-a', 6), b1: terr('b1', 'land-b', 4), c1: terr('c1', 'land-c', 3) },
      }), {
        ...isolatedMap(gameId, ['a1', 'b1', 'c1']),
        connections: [{ from: 'a1', to: 'b1', type: 'land' }],
      } as GameMap);
      const b = await connect('land-b');
      await joinRoom('land-b', gameId);
      const a = await connect('land-a');
      await joinRoom('land-a', gameId);

      // b resigns on a's turn: b1 goes neutral, its garrison halved to 2.
      b.emit('game:resign', { gameId });
      await waitForRedisState(gameId, (s) => s.territories.b1.owner_id === null);
      const outcome = Promise.race([
        new Promise<string>((resolve) => a.once('game:combat_result', () => resolve('combat'))),
        new Promise<string>((resolve) => a.once('error', (e: { message?: string }) => resolve(`error: ${e.message}`))),
      ]);
      a.emit('game:attack', { gameId, fromId: 'a1', toId: 'b1' });
      expect(await outcome).toBe('combat');
    }, 20_000);

    it('lapses the resigner\'s truce offer rather than let it be accepted', async () => {
      const gameId = 'handoff-resign-truce';
      await seed(gameId, buildState(gameId, {
        phase: 'attack',
        turn_number: 4,
        players: [player('truce-a', 0), player('truce-b', 1), player('truce-c', 2)],
        territories: { a1: terr('a1', 'truce-a', 3), b1: terr('b1', 'truce-b', 3), c1: terr('c1', 'truce-c', 3) },
        settings: { ...buildState(gameId, {}).settings, diplomacy_enabled: true },
        diplomacy: [{ player_index_a: 0, player_index_b: 1, status: 'neutral', truce_turns_remaining: 0 }],
        pending_truces: [{ proposer_id: 'truce-b', target_id: 'truce-a' }],
      }), isolatedMap(gameId, ['a1', 'b1', 'c1']));
      const b = await connect('truce-b');
      await joinRoom('truce-b', gameId);
      const a = await connect('truce-a');
      await joinRoom('truce-a', gameId);

      b.emit('game:resign', { gameId });
      await waitForRedisState(gameId, (s) => s.players[1]!.is_eliminated);
      const reply = Promise.race([
        new Promise<string>((resolve) => a.once('game:truce_result', () => resolve('accepted'))),
        new Promise<string>((resolve) => a.once('error', (e: { message?: string }) => resolve(e.message ?? ''))),
      ]);
      a.emit('game:truce_response', { gameId, proposerId: 'truce-b', accepted: true });
      expect(await reply).toMatch(/lapsed/);
      const s = await waitForRedisState(gameId, (st) => (st.pending_truces ?? []).length === 0);
      expect({ status: s.diplomacy[0]!.status, credited: s.players[0]!.truces_established ?? [] })
        .toEqual({ status: 'neutral', credited: [] });
    }, 20_000);
  });

  // ── Winning without a capture ───────────────────────────────────────────────

  describe('winning without a capture', () => {
    // Transcendence: the final era of the spine (Medieval on 'poc') and a wonder.
    const transcendenceSettings = {
      fog_of_war: false,
      allowed_victory_conditions: ['domination', 'transcendence'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      era_advancement_enabled: true,
      era_advancement_spine_id: 'poc',
      economy_enabled: true,
    } as GameState['settings'];

    /** The first game:state the room is told is over, or null after `ms`. */
    function gameOverState(client: ClientSocket, ms = 3_000): Promise<GameState | null> {
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        client.on('game:state', (s: GameState) => {
          if (s.phase === 'game_over') { clearTimeout(t); resolve(s); }
        });
      });
    }

    it('a wonder that completes Transcendence wins on the spot', async () => {
      const gameId = 'handoff-win-wonder';
      await seed(gameId, buildState(gameId, {
        players: [
          player('wonder-a', 0, { current_era_index: 1, special_resource: 500 }),
          player('wonder-b', 1),
        ],
        territories: { a1: terr('a1', 'wonder-a', 3), b1: terr('b1', 'wonder-b', 3) },
        settings: transcendenceSettings,
      }), isolatedMap(gameId, ['a1', 'b1']));
      const a = await connect('wonder-a');
      await joinRoom('wonder-a', gameId);

      const over = gameOverState(a);
      a.emit('game:build', { gameId, territoryId: 'a1', buildingType: 'wonder_cathedral' });
      const s = await over;
      expect(s && { winner: s.winner_id, condition: s.victory_condition })
        .toEqual({ winner: 'wonder-a', condition: 'transcendence' });
    }, 20_000);

    it('reaching the final era with a wonder in hand wins on the spot', async () => {
      const gameId = 'handoff-win-era';
      const a1 = { ...terr('a1', 'era-a', 3), buildings: ['wonder_colosseum'] } as TerritoryState;
      await seed(gameId, buildState(gameId, {
        era: 'ancient',
        players: [
          player('era-a', 0, { current_era_index: 0, special_resource: 500 }),
          player('era-b', 1),
        ],
        territories: { a1, b1: terr('b1', 'era-b', 3) },
        settings: transcendenceSettings,
      }), isolatedMap(gameId, ['a1', 'b1']));
      const a = await connect('era-a');
      await joinRoom('era-a', gameId);

      const over = gameOverState(a);
      a.emit('game:advance_era', { gameId });
      const s = await over;
      expect(s && { winner: s.winner_id, condition: s.victory_condition })
        .toEqual({ winner: 'era-a', condition: 'transcendence' });
    }, 20_000);

    it('an atom bomb that takes the last rival\'s last tile ends the game before the board goes out', async () => {
      const gameId = 'handoff-win-bomb';
      await seed(gameId, buildState(gameId, {
        era: 'ww2',
        phase: 'attack',
        // A bomb carried over from an earlier era: no tech tree needed to fire it.
        players: [player('bomb-a', 0, { legacy_ability_charges: { atom_bomb: 1 } }), player('bomb-b', 1)],
        territories: { a1: terr('a1', 'bomb-a', 6), b1: terr('b1', 'bomb-b', 3) },
      }), isolatedMap(gameId, ['a1', 'b1']));
      const a = await connect('bomb-a');
      await joinRoom('bomb-a', gameId);

      const firstState = new Promise<GameState>((resolve) => a.once('game:state', resolve));
      a.emit('game:use_ability', { gameId, abilityId: 'atom_bomb', params: { territoryId: 'b1' } });
      const s = await firstState;
      expect({ phase: s.phase, winner: s.winner_id, condition: s.victory_condition })
        .toEqual({ phase: 'game_over', winner: 'bomb-a', condition: 'last_standing' });
    }, 20_000);

    it('a bot that reaches the final era with a wonder in hand wins on the spot too', async () => {
      const gameId = 'handoff-win-bot';
      const t1 = { ...terr('t1', 'erabot-a1', 3), buildings: ['wonder_colosseum'] } as TerritoryState;
      await seed(gameId, buildState(gameId, {
        era: 'ancient',
        phase: 'fortify',
        turn_number: 5,
        players: [
          player('erabot-h', 0),
          // An expert with gold to spare on a quiet board advances as its turn opens.
          player('erabot-a1', 1, { is_ai: true, ai_difficulty: 'expert', current_era_index: 0, special_resource: 500 }),
        ],
        territories: { h1: terr('h1', 'erabot-h', 3), t1 },
        settings: transcendenceSettings,
      }), isolatedMap(gameId, ['h1', 't1']));
      const h = await connect('erabot-h');
      await joinRoom('erabot-h', gameId);
      const botPhases: string[] = [];
      let backToHuman = false;
      h.on('game:state', (st: GameState) => {
        if (st.current_player_index === 1) botPhases.push(st.phase);
        else if (botPhases.length > 0) backToHuman = true;
      });

      h.emit('game:advance_phase', { gameId }); // h ends the turn; the bot's opens
      const finalized = () => pg.poolCalls.some((sql) => sql.includes("SET status = 'completed'"));
      for (let i = 0; i < 300 && !finalized(); i++) await sleep(25);
      await sleep(300);
      // The bot's era advance ends the game in its draft: no attack or fortify
      // played on a won board, and no hand-off first.
      expect({ finalized: finalized(), playedOn: botPhases.filter((p) => p !== 'draft'), backToHuman })
        .toEqual({ finalized: true, playedOn: [], backToHuman: false });
    }, 20_000);
  });

  // ── Choice cards ──────────────────────────────────────────────────────────────

  describe('choice cards', () => {
    /** Choice x: +1 reinforcement for whoever answers it (credited to the draft pool). */
    const dilemma: EventCard = {
      card_id: 'dilemma',
      title: 'Dilemma',
      description: 'Pick one',
      category: 'player_targeted',
      era_id: 'custom',
      choices: [
        { choice_id: 'x', label: 'X', effect: { type: 'units_added', target: 'player', value: 1 } },
        { choice_id: 'y', label: 'Y', effect: { type: 'units_added', target: 'player', value: 2 } },
      ],
    } as EventCard;

    const choiceSettings = {
      fog_of_war: false,
      allowed_victory_conditions: ['domination'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      events_enabled: true,
      event_impact_scaling_enabled: false,
    } as GameState['settings'];

    it('an away seat whose turn opens on a choice card is covered, and answers it', async () => {
      const gameId = 'handoff-choice-away';
      await seed(gameId, buildState(gameId, {
        era: 'custom' as GameState['era'],
        phase: 'fortify',
        turn_number: 2,
        players: [
          player('away-a', 0),
          // Dropped two minutes ago: the reconnect window is long over.
          player('away-b', 1, { is_away: true, away_since: Date.now() - 120_000 }),
        ],
        territories: { a1: terr('a1', 'away-a', 3), b1: terr('b1', 'away-b', 3) },
        settings: choiceSettings,
        seasonal_event_cards: [],
        pending_event: { card: dilemma, target_player_id: 'away-b' },
      }), isolatedMap(gameId, ['a1', 'b1']));
      const a = await connect('away-a');
      // Present: the away-AI covers a seat only while someone else waits on it.
      await joinRoomPresent('away-a', gameId);

      // a ends the turn; b's turn opens on the card with nobody there to answer.
      a.emit('game:advance_phase', { gameId });
      const s = await waitForRedisState(gameId, (st) => st.turn_number === 3 && st.current_player_index === 0, 10_000);
      // The away-AI took choice x for b (+1 to b's draft of 3, all onto b1),
      // played b's turn and handed back; the card did not follow to a.
      expect({ b1: s.territories.b1.unit_count, card: s.active_event?.card_id ?? null })
        .toEqual({ b1: 3 + 1 + 3, card: null });
    }, 20_000);

    it('pauses a present player\'s clock while their choice card waits, then runs it', async () => {
      const gameId = 'handoff-choice-clock';
      const aDeadline = Date.now() + 30_000;
      await seed(gameId, buildState(gameId, {
        era: 'custom' as GameState['era'],
        phase: 'fortify',
        turn_number: 2,
        players: [player('clock-a', 0), player('clock-b', 1)],
        territories: { a1: terr('a1', 'clock-a', 3), b1: terr('b1', 'clock-b', 3) },
        settings: { ...choiceSettings, turn_timer_seconds: 60 },
        seasonal_event_cards: [],
        pending_event: { card: dilemma, target_player_id: 'clock-b' },
        phase_deadline_at: aDeadline,
      }), isolatedMap(gameId, ['a1', 'b1']));
      await timer.scheduleTurnTimeout(gameId, aDeadline); // a's clock, still running
      const a = await connect('clock-a');
      await joinRoom('clock-a', gameId);
      const b = await connect('clock-b');
      await joinRoom('clock-b', gameId);

      const cardShown = new Promise<EventCard>((resolve) => b.once('game:event_card', resolve));
      a.emit('game:advance_phase', { gameId });
      expect((await cardShown).card_id).toBe('dilemma');
      const paused = await waitForRedisState(gameId, (st) => st.current_player_index === 1);
      await sleep(200);
      const aJob = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, aDeadline));
      // No clock while b decides — neither a fresh one nor a's leftover.
      expect({ deadline: paused.phase_deadline_at ?? null, aClock: aJob ? await aJob.getState() : 'none' })
        .toEqual({ deadline: null, aClock: 'none' });

      b.emit('game:event_choice', { gameId, choiceId: 'x' });
      const running = await waitForRedisState(gameId, (st) => typeof st.phase_deadline_at === 'number');
      const bJob = await timer.turnTimerQueue.getJob(timer.turnTimerJobId(gameId, running.phase_deadline_at!));
      expect({
        card: running.active_event?.card_id ?? null,
        clockSeconds: Math.round((running.phase_deadline_at! - Date.now()) / 1000),
        bClock: bJob ? await bJob.getState() : 'none',
      }).toEqual({ card: null, clockSeconds: 60, bClock: 'delayed' });
    }, 20_000);

    it('a bot answers its own choice card rather than passing it to the next player', async () => {
      const gameId = 'handoff-choice-bot';
      await seed(gameId, buildState(gameId, {
        era: 'custom' as GameState['era'],
        phase: 'fortify',
        turn_number: 2,
        players: [
          player('botcard-h', 0),
          player('botcard-a1', 1, { is_ai: true, ai_difficulty: 'easy' }),
          player('botcard-a2', 2, { is_ai: true, ai_difficulty: 'easy' }),
        ],
        territories: { h1: terr('h1', 'botcard-h', 3), t1: terr('t1', 'botcard-a1', 3), t2: terr('t2', 'botcard-a2', 3) },
        settings: choiceSettings,
        seasonal_event_cards: [],
        pending_event: { card: dilemma, target_player_id: 'botcard-a1' },
      }), isolatedMap(gameId, ['h1', 't1', 't2']));
      const h = await connect('botcard-h');
      await joinRoom('botcard-h', gameId);

      // h ends the turn; a1 opens on its card, a2 plays, the turn returns to h.
      h.emit('game:advance_phase', { gameId });
      const s = await waitForRedisState(gameId, (st) => st.turn_number === 3 && st.current_player_index === 0, 15_000);
      expect({
        t1: s.territories.t1.unit_count, // a1: 3 + draft 3 + choice x's 1
        t2: s.territories.t2.unit_count, // a2: 3 + draft 3, nothing of a1's card
        card: s.active_event?.card_id ?? null,
      }).toEqual({ t1: 7, t2: 6, card: null });
    }, 30_000);
  });
});

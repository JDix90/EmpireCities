/**
 * Away seats through the real socket server and a real Redis room: a player
 * who drops is marked away, and the away-AI covers their turns for the people
 * still at the table.
 *
 * Redis-gated like the rest of the Redis tier:
 *   redis-server --port 6399 --save '' --appendonly no --requirepass chronoredis --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/awaySeatSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Postgres stand-in: answers the lookups game:join and the disconnect path make.
const lobby = vi.hoisted(() => ({
  players: new Map<string, Array<Record<string, unknown>>>(),
  settings: new Map<string, Record<string, unknown>>(),
  /** games.async_turn_deadline, for the async deadline restore on join. */
  asyncDeadlines: new Map<string, Date>(),
}));
vi.mock('../db/postgres', () => {
  const result = { rows: [] as unknown[], rowCount: 0 };
  const client = { query: async () => result, release: () => {} };
  return {
    query: async (sql: string, params: unknown[] = []) =>
      sql.includes('FROM game_players gp') ? lobby.players.get(params[0] as string) ?? [] : [],
    queryOne: async (sql: string, params: unknown[] = []) => {
      const gameId = params[0] as string;
      if (sql.includes('join_code') && sql.includes('FROM games WHERE game_id')) {
        return {
          game_id: gameId, era_id: 'medieval', map_id: gameId, status: 'in_progress',
          settings_json: lobby.settings.get(gameId) ?? {}, join_code: null, winner_id: null, is_ranked: false,
        };
      }
      if (sql.includes('SELECT map_id, status FROM games')) return { map_id: gameId, status: 'in_progress' };
      if (sql.includes('SELECT map_id FROM games')) return { map_id: gameId };
      if (sql.includes('SELECT async_turn_deadline FROM games')) {
        const at = lobby.asyncDeadlines.get(gameId);
        return at ? { async_turn_deadline: at } : null;
      }
      return null;
    },
    withTransaction: async (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    connectPostgres: async () => {},
    pgConnectionHint: () => null,
    pgPool: { query: async () => result, connect: async () => client, end: async () => {}, on: () => {}, waitingCount: 0, totalCount: 0, idleCount: 0 },
  };
});
// The reconnect window is 45s in play; 1s keeps the away-AI inside a test.
vi.mock('../game-engine/state/seatTakeover', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game-engine/state/seatTakeover')>()),
  AWAY_AI_GRACE_MS: 1_000,
}));
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, GameMap, PlayerState, TerritoryState } from '../types';

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('away seat socket integration', () => {
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
    asyncWorker = await import('../workers/asyncDeadlineWorker');

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => { /* best effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    const ids = createdGames.splice(0);
    // No worker runs here, but a clock a timed test armed must not wait in the
    // queue for a suite that starts one.
    const jobs = await timer.turnTimerQueue.getJobs(['delayed', 'waiting']).catch(() => []);
    await Promise.all(jobs
      .filter((j) => j && ids.includes(j.data.gameId))
      .map((j) => j.remove().catch(() => {})));
    const asyncJobs = await asyncWorker.asyncDeadlineQueue.getJobs(['delayed', 'waiting']).catch(() => []);
    await Promise.all(asyncJobs
      .filter((j) => j && ids.includes(j.data.gameId))
      .map((j) => j.remove().catch(() => {})));
    for (const id of ids) {
      lobby.asyncDeadlines.delete(id);
      await deleteGameKeys(id).catch(() => {});
    }
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  // Each test seats its own player ids: game:state goes to per-user rooms, and
  // an away-AI turn a test left queued can still broadcast after it ends.
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

  /** One territory per seat and no connections: an AI turn only drafts. */
  function isolatedMap(gameId: string, ids: string[]): GameMap {
    return {
      map_id: gameId,
      name: 'Away Seat Test',
      era: 'medieval',
      territories: ids.map((id, i) => ({
        territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [i, 0], region_id: `r_${id}`,
      })),
      connections: [],
      regions: ids.map((id) => ({ region_id: `r_${id}`, name: id, bonus: 0 })),
    } as unknown as GameMap;
  }

  const baseSettings = {
    fog_of_war: false,
    allowed_victory_conditions: ['domination'],
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
  } as GameState['settings'];

  /** Two humans, one tile each, on turn 5 of an untimed game; seat 0 to move. */
  function twoHumans(gameId: string, a: string, b: string, overrides: Partial<GameState> = {}): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'draft',
      current_player_index: 0,
      turn_number: 5,
      players: [player(a, 0), player(b, 1)],
      territories: { [`${a}1`]: terr(`${a}1`, a, 3), [`${b}1`]: terr(`${b}1`, b, 3) },
      card_deck: [],
      card_set_redemption_count: 0,
      diplomacy: [],
      settings: baseSettings,
      draft_units_remaining: 3,
      turn_started_at: Date.now(),
      era_modifiers: {},
      ...overrides,
    } as GameState;
  }

  function lobbyRow(userId: string | null, idx: number, isAi = false) {
    return {
      player_index: idx, user_id: userId, username: userId?.toUpperCase() ?? `AI ${idx}`,
      player_color: '#888', is_ai: isAi, ai_difficulty: isAi ? 'easy' : null, is_eliminated: false, faction_id: null,
    };
  }

  // ── Harness helpers ───────────────────────────────────────────────────────────

  async function seed(
    gameId: string,
    state: GameState,
    map: GameMap = isolatedMap(gameId, Object.keys(state.territories)),
  ): Promise<void> {
    await setGameState(gameId, state);
    await setGameMap(gameId, map);
    lobby.players.set(gameId, state.players.map((p) => lobbyRow(p.is_ai ? null : p.player_id, p.player_index, p.is_ai)));
    lobby.settings.set(gameId, state.settings as Record<string, unknown>);
    createdGames.push(gameId);
  }

  /** Connect and game:join, as a client opening the game page does. */
  async function join(userId: string, gameId: string): Promise<ClientSocket> {
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
    const joined = new Promise<void>((resolve) => client.once('game:joined', () => resolve()));
    client.emit('game:join', { gameId });
    await joined;
    return client;
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

  const seat = (s: GameState, id: string) => s.players.find((p) => p.player_id === id)!;

  // ── Marking a seat away ───────────────────────────────────────────────────────

  describe('marking a seat away', () => {
    it('lands after the room lock frees up when the player drops mid-action', async () => {
      const gameId = 'away-mark-busy';
      await seed(gameId, twoHumans(gameId, 'busy-a', 'busy-b'));
      await join('busy-a', gameId);
      const b = await join('busy-b', gameId);

      // Stand-in for a bot turn holding the room lock for a few seconds.
      const { runWithGameLock } = await import('./gameLock');
      const busy = runWithGameLock(gameId, () => sleep(2_500), 10_000);
      await sleep(50);
      b.disconnect();
      await busy;

      const s = await waitForRedisState(gameId, (st) => !!seat(st, 'busy-b').is_away, 6_000).catch(() => null);
      expect(s && seat(s, 'busy-b').is_away).toBe(true);
    }, 20_000);

    it('hands the seat back after the room lock frees up when the player returns mid-action', async () => {
      const gameId = 'away-reclaim-busy';
      await seed(gameId, twoHumans(gameId, 'back-a', 'back-b', {
        players: [player('back-a', 0), player('back-b', 1, { is_away: true, away_since: Date.now() })],
      }));
      await join('back-a', gameId);

      const { runWithGameLock } = await import('./gameLock');
      const busy = runWithGameLock(gameId, () => sleep(2_500), 10_000);
      await sleep(50);
      await join('back-b', gameId);
      await busy;

      const s = await waitForRedisState(gameId, (st) => !seat(st, 'back-b').is_away, 6_000).catch(() => null);
      expect(s && seat(s, 'back-b').is_away).toBe(false);
    }, 20_000);
  });

  // ── Covering an away seat ─────────────────────────────────────────────────────

  describe('covering an away seat', () => {
    it.each([
      ['an untimed', 0],
      ['a timed', 60],
    ])('after a restart, %s game covers the away seat once a player joins', async (_label, seconds) => {
      const gameId = `away-restart-${seconds}`;
      const [a, b] = [`restart${seconds}-a`, `restart${seconds}-b`];
      // b dropped two minutes ago, on b's turn. The away-AI timer that was
      // waiting to cover it went down with the process that armed it.
      await seed(gameId, twoHumans(gameId, a, b, {
        current_player_index: 1,
        players: [player(a, 0), player(b, 1, { is_away: true, away_since: Date.now() - 120_000 })],
        settings: { ...baseSettings, turn_timer_seconds: seconds },
      }));
      await join(a, gameId);

      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 0, 8_000).catch(() => null);
      // The away-AI drafted b's 3 units onto b's tile and handed the turn back.
      expect(s && { seat: s.current_player_index, bTile: s.territories[`${b}1`].unit_count })
        .toEqual({ seat: 0, bTile: 6 });
    }, 20_000);

    it.each([
      ['a solo game', 'solo', {}],
      ['a Daily Challenge', 'daily', { daily_challenge_date: '2026-09-28', daily_challenge_spec: { archetype: 'domination', par_turns: 6 } }],
    ])('leaves a lone player\'s seat to its player in %s', async (_label, key, extra) => {
      const gameId = `away-lone-${key}`;
      const [h, bot] = [`lone${key}-h`, `lone${key}-bot`];
      await seed(gameId, twoHumans(gameId, h, bot, {
        turn_number: 2,
        players: [player(h, 0), player(bot, 1, { is_ai: true, ai_difficulty: 'easy' })],
        settings: { ...baseSettings, ...extra } as GameState['settings'],
      }));
      const client = await join(h, gameId);

      client.disconnect(); // mid-turn: the phone sleeps, the tab drops
      await waitForRedisState(gameId, (st) => !!seat(st, h).is_away);
      await sleep(3_000); // past the reconnect window and the cover's 1s lag

      // Nobody else is waiting on h: the run is h's to play when h is back.
      const s = (await getGameState(gameId))!;
      expect({ turn: s.turn_number, seat: s.current_player_index, phase: s.phase, tile: s.territories[`${h}1`].unit_count })
        .toEqual({ turn: 2, seat: 0, phase: 'draft', tile: 3 });
    }, 20_000);

    it('finishes a half-played turn from the phase its player left', async () => {
      const gameId = 'away-half-turn';
      // a drafted, attacked and made the one fortify move a turn allows, then
      // dropped. a's rear tile a0 could still reinforce a1, and a1 could take b1
      // (b keeps b2, so the game would go on).
      await seed(gameId, twoHumans(gameId, 'half-a', 'half-b', {
        phase: 'fortify',
        fortify_moves_used: 1,
        draft_units_remaining: 0,
        players: [player('half-a', 0, { is_away: true, away_since: Date.now() - 120_000 }), player('half-b', 1)],
        territories: {
          a0: terr('a0', 'half-a', 8), a1: terr('a1', 'half-a', 6),
          b1: terr('b1', 'half-b', 1), b2: terr('b2', 'half-b', 3),
        },
      }), {
        ...isolatedMap(gameId, ['a0', 'a1', 'b1', 'b2']),
        connections: [{ from: 'a0', to: 'a1', type: 'land' }, { from: 'a1', to: 'b1', type: 'land' }],
      } as GameMap);
      const b = await join('half-b', gameId);
      const phasesForA: string[] = [];
      let combats = 0;
      b.on('game:state', (st: GameState) => { if (st.current_player_index === 0) phasesForA.push(st.phase); });
      b.on('game:combat_result', () => { combats += 1; });

      // b's join re-arms the away-AI, which ends a's turn: no second draft or
      // attack phase, and no fortify move beyond the one a already made.
      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 1, 8_000);
      expect({
        replayed: phasesForA.filter((p) => p === 'draft' || p === 'attack'),
        combats,
        tiles: [s.territories.a0.unit_count, s.territories.a1.unit_count, s.territories.b1.unit_count],
        b1Owner: s.territories.b1.owner_id,
      }).toEqual({ replayed: [], combats: 0, tiles: [8, 6, 1], b1Owner: 'half-b' });
    }, 20_000);

    it('waits while nobody else is at the table, and covers the seat once someone is back', async () => {
      const gameId = 'away-empty-table';
      await seed(gameId, twoHumans(gameId, 'empty-a', 'empty-b', { current_player_index: 1 }));
      const a = await join('empty-a', gameId);
      const b = await join('empty-b', gameId);

      a.disconnect();
      b.disconnect(); // on b's own turn, and a is gone too
      await waitForRedisState(gameId, (st) => !!seat(st, 'empty-b').is_away);
      await sleep(3_000); // past the reconnect window and the cover's 1s lag
      expect((await getGameState(gameId))!.current_player_index).toBe(1);

      await join('empty-a', gameId);
      const s = await waitForRedisState(gameId, (st) => st.current_player_index === 0, 8_000).catch(() => null);
      expect(s && s.territories['empty-b1'].unit_count).toBe(6);
    }, 25_000);
  });

  // ── Restoring an async deadline on join ──────────────────────────────────────

  describe('restoring an async deadline on join', () => {
    const asyncSettings = {
      ...baseSettings,
      turn_timer_seconds: 86400,
      async_mode: true,
      async_turn_deadline_seconds: 86400,
    } as GameState['settings'];

    /** The async deadline job named for `deadlineAt`, once queued, or null. */
    async function asyncJob(gameId: string, deadlineAt: number) {
      const id = asyncWorker.asyncDeadlineJobId(gameId, deadlineAt);
      for (let i = 0; i < 100 && !(await asyncWorker.asyncDeadlineQueue.getJob(id)); i++) await sleep(20);
      const job = await asyncWorker.asyncDeadlineQueue.getJob(id);
      return job ? { state: await job.getState(), data: job.data } : null;
    }

    it('re-queues a lost deadline job under the deadline the game carries', async () => {
      const gameId = 'away-async-restore';
      const day = Date.now() + 86_400_000;
      await seed(gameId, twoHumans(gameId, 'restore-a', 'restore-b', {
        current_player_index: 1, settings: asyncSettings, phase_deadline_at: day,
      }));

      // Anyone's return restores it: here the player who is waiting.
      await join('restore-a', gameId);
      expect(await asyncJob(gameId, day)).toEqual({
        state: 'delayed',
        data: { gameId, turnNumber: 5, playerIndex: 1, deadlineAt: day },
      });
    }, 20_000);

    it('gives a deadline that passed while its job was lost ten seconds, not a lapse mid-join', async () => {
      const gameId = 'away-async-restore-past';
      const past = Date.now() - 60_000;
      await seed(gameId, twoHumans(gameId, 'past-a', 'past-b', {
        current_player_index: 1, settings: asyncSettings, phase_deadline_at: past,
      }));

      await join('past-a', gameId);
      await asyncJob(gameId, past);
      const job = await asyncWorker.asyncDeadlineQueue.getJob(asyncWorker.asyncDeadlineJobId(gameId, past));
      // Queued for later ('delayed'), not due at once ('waiting'); and still
      // named for the deadline the game carries, so it may lapse it.
      expect({ state: await job?.getState(), delay: job?.opts.delay, deadlineAt: job?.data.deadlineAt })
        .toEqual({ state: 'delayed', delay: 10_000, deadlineAt: past });
    }, 20_000);

    it('falls back to the deadline stored in Postgres when the game carries none', async () => {
      const gameId = 'away-async-restore-stored';
      const stored = Date.now() + 3_600_000;
      lobby.asyncDeadlines.set(gameId, new Date(stored));
      await seed(gameId, twoHumans(gameId, 'stored-a', 'stored-b', {
        current_player_index: 1, settings: asyncSettings,
      }));

      await join('stored-a', gameId);
      expect(await asyncJob(gameId, stored)).toEqual({
        state: 'delayed',
        data: { gameId, turnNumber: 5, playerIndex: 1, deadlineAt: stored },
      });
    }, 20_000);
  });
});

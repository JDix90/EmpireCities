/**
 * Integration coverage for the `game:attack` socket handler — the real wire
 * path that the manual multiplayer smoke exercises, now automated.
 *
 * Drives a genuine socket.io server (via initGameSocket) + client against a real
 * Redis-backed game room, with DETERMINISTIC dice injected through
 * `state.puzzle_dice_queue`, and asserts the post-combat broadcasts + state
 * mutations. This is the automated gate for the executeLandAttack unification:
 * it proves the socket orchestration around the shared combat helper (capture,
 * failure, elimination broadcast, era-gap dice flow, vulnerability window,
 * once-per-turn card draw) behaves correctly end to end.
 *
 * Redis-gated like the rest of the Redis tier: runs in CI (REDIS_TEST=1 + a
 * redis service) and skips in plain unit runs. Locally:
 *   redis-server --port 6390 --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6390 \
 *     pnpm exec vitest run src/sockets/gameAttackSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// These tests drive a real socket.io server against a real Redis room. The
// Postgres side is incidental — the debounced state backup, the win path's
// `games` update, a quest-progress read — and none of it is asserted on.
// Before CI had a Postgres service the calls failed with ECONNREFUSED and were
// swallowed; with one (#301) they fail because the fixture ids are not UUIDs,
// and `game_states.game_id` also carries a foreign key to `games`, so valid
// ids alone would only trade a uuid error for an FK one. A no-op Postgres keeps
// the test hermetic and the CI log quiet. Same shape as
// gameCleanupService.test.ts; mirrored in galacticAgeHyperspaceSocket.test.ts
// and spaceAgeMoonLadderSocket.test.ts.
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

const redisTestEnabled = process.env.REDIS_TEST === '1';

describe.runIf(redisTestEnabled)('game:attack socket integration', () => {
  let httpServer: HttpServer;
  let ioServer: IOServer;
  let port: number;
  let signAccessToken: (p: { sub: string; username: string }) => string;
  let setGameState: (id: string, s: GameState) => Promise<void>;
  let getGameState: (id: string) => Promise<GameState | null>;
  let setGameMap: (id: string, m: GameMap) => Promise<void>;
  let deleteGameKeys: (id: string) => Promise<void>;
  let shutdownGameSocket: (io: IOServer) => Promise<void>;
  let redisClient: typeof import('../db/redis').redis;

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
    redisClient = redisMod.redis;
    await redisMod.redis.connect().catch(() => { /* lazyConnect — may already be connecting */ });

    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    // Closes the socket.io server + its Redis adapter + the BullMQ workers.
    // The shared `redis` singleton is intentionally left open (matching
    // redisGameStore.test.ts) so sibling Redis-tier files aren't disconnected.
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  // The socket rate limiter is Redis-backed and keyed by user id: 30 gameplay
  // events per 10 s. Every test here acts as the same three users, so without
  // a reset the file's own traffic, or a re-run inside the window, throttles a
  // later test, and a throttled event is dropped without a reply.
  beforeEach(async () => {
    for (const user of ['p1', 'p2', 'p3']) {
      const keys = await redisClient.keys(`rl:sock:${user}:*`);
      if (keys.length) await redisClient.del(...keys);
    }
  });

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
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

  function terr(id: string, owner: string | null, units: number, extra: Partial<TerritoryState> = {}): TerritoryState {
    return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', ...extra } as TerritoryState;
  }

  /**
   * Trailing dice appended to every non-empty seeded queue.
   *
   * `createPuzzleDieRoll` answers an exhausted queue with `crypto.randomInt`,
   * so a queue sized to exactly the dice a test expects stops being
   * deterministic the moment anything draws one more — and it does: the
   * vulnerability-window test below sets `current_era_index: 0`, which is the
   * Ancient era, whose `legion_reroll` re-rolls the attacker's lowest die.
   * That fifth draw was unseeded on every run.
   *
   * 1 is the safe filler. `legion_reroll` and `rifle_doctrine` both keep
   * `Math.max(original, reroll)`, so a 1 is a guaranteed no-op, and a stray
   * defender die of 1 loses every comparison it can lose. The tail therefore
   * cannot change any outcome these tests assert — it only stops an unplanned
   * draw from reaching the RNG.
   */
  const DICE_SAFETY_TAIL: number[] = Array(8).fill(1);

  /**
   * 3-player domination game in the attack phase, p1 (current) on territory `a`
   * adjacent to p2's `b`; p3 holds `c` (so eliminating p2 never ends the game).
   * `dice` seeds the deterministic combat roll: all attacker dice, then defender.
   * An empty array is passed through untouched, leaving combat on the real RNG
   * for the tests that never fight.
   */
  function buildState(gameId: string, dice: number[], overrides: Partial<GameState> = {}): GameState {
    return {
      game_id: gameId,
      era: 'medieval',
      map_id: gameId,
      phase: 'attack',
      current_player_index: 0,
      turn_number: 3,
      players: [
        player('p1', 0, { territory_count: 1, cards: [] }),
        player('p2', 1, { territory_count: 1 }),
        player('p3', 2, { territory_count: 1 }),
      ],
      territories: {
        a: terr('a', 'p1', 4),
        b: terr('b', 'p2', 1),
        c: terr('c', 'p3', 5),
      },
      card_deck: [
        { card_id: 'd1', territory_id: 'a', symbol: 'infantry' },
        { card_id: 'd2', territory_id: 'b', symbol: 'cavalry' },
        { card_id: 'd3', territory_id: 'c', symbol: 'artillery' },
      ],
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
      // NB: this does NOT disable legion_reroll — executeLandAttack reads the
      // ATTACKER's era via getPlayerEraModifiers(state, from.owner_id), not this
      // field. A test that pins current_era_index to 0 gets the Ancient re-roll
      // whatever is set here; DICE_SAFETY_TAIL is what keeps that deterministic.
      era_modifiers: {},
      puzzle_dice_queue: dice.length ? [...dice, ...DICE_SAFETY_TAIL] : dice,
      ...overrides,
    } as GameState;
  }

  function buildMap(gameId: string): GameMap {
    return {
      map_id: gameId,
      name: 'Attack Test',
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

  function waitFor<T = unknown>(
    client: ClientSocket,
    event: string,
    timeoutMs = 5_000,
    accept: (payload: T) => boolean = () => true,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const onEvent = (payload: T) => {
        if (!accept(payload)) return;
        clearTimeout(t);
        client.off(event, onEvent);
        resolve(payload);
      };
      const t = setTimeout(() => {
        client.off(event, onEvent);
        reject(new Error(`timeout waiting for ${event}`));
      }, timeoutMs);
      client.on(event, onEvent);
    });
  }

  /**
   * The next `game:state` for `gameId`, skipping any other game's.
   *
   * broadcastState sends each human their state through their user room
   * (`user:p1`), and the Redis adapter carries that to every socket server on
   * the same Redis. In CI that includes the socket test files running beside
   * this one, several of which seat a human `p1` too. So the next `game:state`
   * this client receives can be from another file's game. GamePage skips other
   * games' states the same way.
   */
  function waitForState(client: ClientSocket, gameId: string): Promise<GameState> {
    return waitFor<GameState>(client, 'game:state', 5_000, (s) => s.game_id === gameId);
  }

  /**
   * Poll Redis until the persisted state matches `predicate`. The handler
   * persists fire-and-forget AFTER broadcasting, so a follow-up action that
   * reloads from Redis must wait for the write to land (deterministic, no sleep).
   */
  async function waitForRedisState(gameId: string, predicate: (s: GameState) => boolean): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const s = await getGameState(gameId);
      if (s && predicate(s)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for persisted Redis state');
  }

  type CombatPayload = { fromId: string; toId: string; result: {
    attacker_rolls: number[]; defender_rolls: number[]; attacker_losses: number;
    defender_losses: number; territory_captured: boolean; source_units_after?: number;
  } };

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('captures a territory and broadcasts combat_result + filtered state', async () => {
    const gameId = 'itest-capture';
    await seed(gameId, buildState(gameId, [6, 6, 6, 1]), buildMap(gameId)); // attacker sweeps
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    const stateEvt = waitForState(client, gameId);
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });

    const cr = await combat;
    expect(cr.result.territory_captured).toBe(true);
    expect(cr.result.attacker_rolls).toEqual([6, 6, 6]);
    expect(cr.result.defender_rolls).toEqual([1]);
    expect(cr.result.source_units_after).toBe(4); // a had 4; no attacker losses this exchange

    const st = await stateEvt;
    expect(st.territories.b.owner_id).toBe('p1'); // captured
    expect(st.territories.b.unit_count).toBe(3);  // min(from-1, 3) advanced in
    expect(st.territories.a.unit_count).toBe(1);  // remainder left behind
    // The seeded dice stream is every roll still to come, and on a daily it is
    // the same for every player. It stays on the server.
    expect(st.puzzle_dice_queue).toBeUndefined();
    expect(JSON.stringify(st)).not.toContain('puzzle_dice_queue');
  });

  it('resolves a failed attack without capture', async () => {
    const gameId = 'itest-fail';
    // Defender wins both dice comparisons → attacker takes 2 losses, b survives.
    await seed(gameId, buildState(gameId, [1, 1, 1, 6]), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });

    const cr = await combat;
    expect(cr.result.territory_captured).toBe(false);
    expect(cr.result.attacker_losses).toBe(1); // 1 defender die vs 3 attacker → 1 comparison
    expect(cr.result.defender_losses).toBe(0);
  });

  it('broadcasts player_eliminated when the defender loses their last territory', async () => {
    const gameId = 'itest-elim';
    await seed(gameId, buildState(gameId, [6, 6, 6, 1]), buildMap(gameId)); // p2 owns only b
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const elim = waitFor<{ playerId: string; eliminatorId: string }>(client, 'game:player_eliminated');
    const stateEvt = waitForState(client, gameId);
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });

    const e = await elim;
    expect(e.playerId).toBe('p2');
    expect(e.eliminatorId).toBe('p1');

    const st = await stateEvt;
    expect(st.players.find((p) => p.player_id === 'p2')?.is_eliminated).toBe(true);
    expect(st.phase).not.toBe('game_over'); // p3 still alive — no victory
  });

  it('draws at most one territory card per turn across two captures', async () => {
    const gameId = 'itest-card';
    // a(5)->b(1): 3 attacker + 1 defender dice. b then holds 3 units, so
    // b(3)->c(1): 2 attacker + 1 defender dice. Both forced captures.
    const state = buildState(gameId, [6, 6, 6, 1, /* b->c */ 6, 6, 1], {
      territories: {
        a: terr('a', 'p1', 5),
        b: terr('b', 'p2', 1),
        c: terr('c', 'p3', 1),
      },
    });
    await seed(gameId, state, buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const firstState = waitForState(client, gameId);
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    await firstState;
    // The first attack persists fire-and-forget; wait for it before reloading.
    await waitForRedisState(gameId, (s) => s.territories.b.owner_id === 'p1');

    const secondState = waitForState(client, gameId);
    client.emit('game:attack', { gameId, fromId: 'b', toId: 'c' });
    const st = await secondState;

    const p1 = st.players.find((p) => p.player_id === 'p1')!;
    expect(st.territories.b.owner_id).toBe('p1');
    expect(st.territories.c.owner_id).toBe('p1');
    expect(p1.cards.length).toBe(1); // exactly one card despite two captures
  });

  it('flows the era-gap attack die through the socket path (EA-203)', async () => {
    const gameId = 'itest-eragap';
    const state = buildState(gameId, [6, 6, 6, 6, 1], {
      players: [
        player('p1', 0, { current_era_index: 1 }),
        player('p2', 1, { current_era_index: 0 }),
        player('p3', 2),
      ],
      settings: {
        fog_of_war: false,
        allowed_victory_conditions: ['domination'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
        era_advancement_enabled: true,
        era_advancement_combat_gap_dice: 1,
      },
    });
    await seed(gameId, state, buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    const cr = await combat;
    // a has 4 units → base 3 attacker dice + 1 era-gap die = 4.
    expect(cr.result.attacker_rolls).toHaveLength(4);
  });

  it('shrinks the defender dice pool during the vulnerability window', async () => {
    const gameId = 'itest-vuln';
    const state = buildState(gameId, [6, 6, 6, 1], {
      players: [
        player('p1', 0, { current_era_index: 0 }),
        player('p2', 1, { current_era_index: 0, era_transition_turns_remaining: 1 }),
        player('p3', 2),
      ],
      territories: {
        a: terr('a', 'p1', 4),
        b: terr('b', 'p2', 4), // 4 defenders would normally roll 2 dice
        c: terr('c', 'p3', 5),
      },
      settings: {
        fog_of_war: false,
        allowed_victory_conditions: ['domination'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
        era_advancement_enabled: true,
        era_advancement_vuln_defense_mult: 0.75,
      },
    });
    await seed(gameId, state, buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    const cr = await combat;
    expect(cr.result.defender_rolls).toHaveLength(1); // vulnerability floors 2 → 1
  });

  it('rejects an attack that is not the user\'s turn', async () => {
    const gameId = 'itest-notturn';
    await seed(gameId, buildState(gameId, [6, 6, 6, 1], { current_player_index: 1 }), buildMap(gameId));
    const client = await connect('p1'); // p1 is not the current player (p2 is)
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    const e = await err;
    expect(e.message).toMatch(/not your turn/i);
    expect(e.code).toBe('NOT_YOUR_TURN');
  });

  // ── Neutral Moon attacks (orbit access denial copy) ─────────────────────────

  /**
   * Space Age board where p1 already holds one Moon tile (m1) next to the
   * neutral garrison on m2 — connected by a LAND edge, as the authored lunar
   * surface is. `connectionRequiresMoonAccess` only fires on `orbit` edges, so
   * this attack skips the orbit-edge gate entirely and used to die inside
   * executeLandAttack, surfacing as the generic 'Invalid attack'.
   */
  function moonState(gameId: string, dice: number[], p1Extras: Partial<PlayerState> = {}): GameState {
    return buildState(gameId, dice, {
      era: 'space_age',
      players: [
        player('p1', 0, { territory_count: 2, ...p1Extras }),
        player('p2', 1, { territory_count: 1 }),
        player('p3', 2, { territory_count: 1 }),
      ],
      territories: {
        a: terr('a', 'p1', 3, { world_id: 'earth' }),
        b: terr('b', 'p2', 1, { world_id: 'earth' }),
        c: terr('c', 'p3', 5, { world_id: 'earth' }),
        m1: terr('m1', 'p1', 5, { world_id: 'moon' }),
        m2: terr('m2', null, 1, { world_id: 'moon' }),
      },
    });
  }

  function moonMap(gameId: string): GameMap {
    const base = buildMap(gameId);
    return {
      ...base,
      era: 'space_age',
      territories: [
        ...base.territories,
        { territory_id: 'm1', name: 'M1', polygon: [], center_point: [3, 0], region_id: 'lunar_surface', world_id: 'moon' },
        { territory_id: 'm2', name: 'M2', polygon: [], center_point: [4, 0], region_id: 'lunar_surface', world_id: 'moon' },
      ],
      connections: [...base.connections, { from: 'm1', to: 'm2', type: 'land' }],
      regions: [...base.regions, { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 0 }],
    } as GameMap;
  }

  it('explains WHY a neutral Moon tile is off limits instead of "Invalid attack"', async () => {
    const gameId = 'itest-moon-denied';
    await seed(gameId, moonState(gameId, [6, 6, 6, 1]), moonMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit('game:attack', { gameId, fromId: 'm1', toId: 'm2' });

    const e = await err;
    expect(e.code).toBe('ACCESS_DENIED');
    expect(e.message).toBe('Moon access requires: Lunar Expansion tech + Launch Pad building + launched Space Station');
    expect(e.message).not.toMatch(/invalid attack/i);
  });

  it('gives the blitz handler the same Moon-access message', async () => {
    const gameId = 'itest-moon-denied-blitz';
    await seed(gameId, moonState(gameId, [6, 6, 6, 1]), moonMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit('game:attack_blitz', { gameId, fromId: 'm1', toId: 'm2' });

    const e = await err;
    expect(e.code).toBe('ACCESS_DENIED');
    expect(e.message).toMatch(/^Moon access requires: /);
  });

  it('still lets a player WITH orbit access take the neutral Moon tile', async () => {
    const gameId = 'itest-moon-allowed';
    // Lunar Pioneers hold orbit access from turn one — the guard must not block them.
    await seed(gameId, moonState(gameId, [6, 6, 6, 1], { faction_id: 'lunar_pioneers' }), moonMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    const stateEvt = waitForState(client, gameId);
    client.emit('game:attack', { gameId, fromId: 'm1', toId: 'm2' });

    expect((await combat).result.territory_captured).toBe(true);
    expect((await stateEvt).territories.m2.owner_id).toBe('p1');
  });

  // ── Fortify confirmation (no double-toast bug) ──────────────────────────────

  it('confirms a successful fortify with game:fortify_result', async () => {
    const gameId = 'itest-fortify-ok';
    // p1 owns a (4) and b (1), connected by land; fortify a → b.
    await seed(gameId, buildState(gameId, [], {
      phase: 'fortify',
      territories: { a: terr('a', 'p1', 4), b: terr('b', 'p1', 1), c: terr('c', 'p3', 5) },
    }), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const result = waitFor<{ fromId: string; toId: string; units: number; inTransit: boolean }>(client, 'game:fortify_result');
    client.emit('game:fortify', { gameId, fromId: 'a', toId: 'b', units: 2 });

    // `inTransit` false: both ends are on the same world, so this is an ordinary
    // instant fortify rather than a convoy (see state/transit.ts).
    expect(await result).toEqual({ fromId: 'a', toId: 'b', units: 2, inTransit: false });
    await waitForRedisState(gameId, (s) => s.territories.a.unit_count === 2 && s.territories.b.unit_count === 3);
  });

  it('rejects an unconnected fortify with an error and NO fortify_result', async () => {
    const gameId = 'itest-fortify-nopath';
    // p1 owns a (4) and c (5), but the only a–c route runs through p2's b → no path.
    await seed(gameId, buildState(gameId, [], {
      phase: 'fortify',
      territories: { a: terr('a', 'p1', 4), b: terr('b', 'p2', 1), c: terr('c', 'p1', 5) },
    }), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    let resultFired = false;
    client.on('game:fortify_result', () => { resultFired = true; });
    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit('game:fortify', { gameId, fromId: 'a', toId: 'c', units: 2 });

    const fortifyErr = await err;
    expect(fortifyErr.message).toBe('No connected path between territories');
    expect(fortifyErr.code).toBe('PATH_NOT_CONNECTED');
    // The success confirmation must NOT also fire — the whole point of the fix.
    await new Promise((r) => setTimeout(r, 50));
    expect(resultFired).toBe(false);
  });

  // ── Fleet Attack ───────────────────────────────────────────────────────────

  it('refuses a Fleet Attack on an empty harbour instead of fighting a phantom ship', async () => {
    const gameId = 'itest-fleet-empty';
    const seaMap = { ...buildMap(gameId), connections: [{ from: 'a', to: 'b', type: 'sea' as const }] };
    const base = buildState(gameId, []);
    await seed(gameId, buildState(gameId, [], {
      phase: 'attack',
      territories: {
        a: { ...terr('a', 'p1', 4), naval_units: 3 },
        b: { ...terr('b', 'p2', 1), naval_units: 0 },
        c: terr('c', 'p3', 5),
      },
      settings: { ...base.settings, naval_enabled: true },
    }), seaMap);
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string }>(client, 'error');
    client.emit('game:naval_attack', { gameId, fromId: 'a', toId: 'b', action_id: 'fleet1' });
    expect((await err).message).toBe('No enemy fleet to attack');
    const after = await getGameState(gameId);
    expect(after?.territories.a.naval_units).toBe(3);
  });

  // ── Truces: any attack on a partner breaks it, once confirmed ───────────────

  /**
   * p1 and p2 hold a truce. p2 also holds `d`, off the board's edges, so no
   * test here eliminates them.
   */
  function truceState(gameId: string, dice: number[], overrides: Partial<GameState> = {}): GameState {
    const base = buildState(gameId, dice);
    return buildState(gameId, dice, {
      players: [
        player('p1', 0, { territory_count: 1 }),
        player('p2', 1, { territory_count: 2 }),
        player('p3', 2, { territory_count: 1 }),
      ],
      territories: { ...base.territories, d: terr('d', 'p2', 3) },
      diplomacy: [{ player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 2 }],
      settings: { ...base.settings, diplomacy_enabled: true },
      ...overrides,
    });
  }

  function truceMap(gameId: string): GameMap {
    const base = buildMap(gameId);
    return {
      ...base,
      territories: [
        ...base.territories,
        { territory_id: 'd', name: 'D', polygon: [], center_point: [3, 3], region_id: 'r' },
      ],
    } as GameMap;
  }

  const truceOf = (s: GameState | null) => s?.diplomacy[0] && {
    status: s.diplomacy[0].status, turns: s.diplomacy[0].truce_turns_remaining,
  };

  /** Emit without `breakTruce`: refused, nothing spent, the truce stands. */
  async function expectTruceRefusal(
    client: ClientSocket, gameId: string, event: string, payload: Record<string, unknown>,
  ): Promise<void> {
    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit(event, { gameId, ...payload });
    expect(await err).toEqual({ message: 'You have an active truce with this player', code: 'TRUCE_ACTIVE' });
    expect(truceOf(await getGameState(gameId))).toEqual({ status: 'truce', turns: 2 });
  }

  type TruceBroken = { breakerId: string; breakerName: string; gameId?: string };

  /**
   * The partner's next truce-broken alert from `gameId`. It goes to their user
   * room, like their state, so it names its game.
   */
  function waitForTruceBroken(client: ClientSocket, gameId: string): Promise<TruceBroken> {
    return waitFor<TruceBroken>(client, 'game:truce_broken', 5_000, (a) => a.gameId === gameId);
  }

  it('breaks a truce with a confirmed land attack, at +1 defense die, and tells the partner', async () => {
    const gameId = 'itest-truce-land';
    // Three attacker dice, then the defender's two: one for the unit, one for the break.
    await seed(gameId, truceState(gameId, [6, 6, 6, 1, 1]), truceMap(gameId));
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    await expectTruceRefusal(client, gameId, 'game:attack', { fromId: 'a', toId: 'b' });

    const alert = waitForTruceBroken(partner, gameId);
    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b', breakTruce: true });
    expect((await combat).result.defender_rolls).toHaveLength(2);
    expect(await alert).toMatchObject({ breakerId: 'p1', breakerName: 'P1', gameId });
    await waitForRedisState(gameId, (s) => s.territories.b.owner_id === 'p1');
    const after = await getGameState(gameId);
    expect(truceOf(after)).toEqual({ status: 'neutral', turns: 0 });
    expect(after?.players[1]!.truce_break_retaliations).toEqual([{ against_player_id: 'p1', dice_bonus: 1 }]);
  });

  it('keeps the truce when a sea attack is refused for want of a fleet', async () => {
    const gameId = 'itest-truce-no-fleet';
    const base = truceState(gameId, []);
    await seed(gameId, truceState(gameId, [], {
      territories: { ...base.territories, a: { ...terr('a', 'p1', 4), naval_units: 0 } },
      settings: { ...base.settings, naval_enabled: true },
    }), { ...truceMap(gameId), connections: [{ from: 'a', to: 'b', type: 'sea' as const }] });
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);
    let alerted = false;
    partner.on('game:truce_broken', () => { alerted = true; });

    const err = waitFor<{ message: string }>(client, 'error');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b', breakTruce: true });
    expect((await err).message).toBe('No fleet to traverse sea lane');
    expect(truceOf(await getGameState(gameId))).toEqual({ status: 'truce', turns: 2 });
    // The break used to come before this refusal: no attack, and the partner
    // still heard the truce was broken.
    await new Promise((r) => setTimeout(r, 50));
    expect(alerted).toBe(false);
  });

  it('lets a blitz break a truce once confirmed, instead of refusing it outright', async () => {
    const gameId = 'itest-truce-blitz';
    await seed(gameId, truceState(gameId, []), truceMap(gameId));
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    await expectTruceRefusal(client, gameId, 'game:attack_blitz', { fromId: 'a', toId: 'b' });

    const alert = waitForTruceBroken(partner, gameId);
    const combat = waitFor<CombatPayload>(client, 'game:combat_result');
    client.emit('game:attack_blitz', { gameId, fromId: 'a', toId: 'b', breakTruce: true });
    await combat;
    expect((await alert).breakerId).toBe('p1');
    await waitForRedisState(gameId, (s) => s.diplomacy[0]?.status === 'neutral');
  });

  it('lets a Fleet Attack break a truce once confirmed, at +1 defense die', async () => {
    const gameId = 'itest-truce-fleet';
    const base = truceState(gameId, []);
    await seed(gameId, truceState(gameId, [], {
      territories: {
        ...base.territories,
        a: { ...terr('a', 'p1', 4), naval_units: 3 },
        b: { ...terr('b', 'p2', 1), naval_units: 1 },
      },
      settings: { ...base.settings, naval_enabled: true },
    }), { ...truceMap(gameId), connections: [{ from: 'a', to: 'b', type: 'sea' as const }] });
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    await expectTruceRefusal(client, gameId, 'game:naval_attack', { fromId: 'a', toId: 'b' });

    const alert = waitForTruceBroken(partner, gameId);
    const naval = waitFor<{ result: { defender_rolls: number[] } }>(client, 'game:naval_combat_result');
    client.emit('game:naval_attack', { gameId, fromId: 'a', toId: 'b', breakTruce: true });
    // One fleet rolls one die; the break adds the second.
    expect((await naval).result.defender_rolls).toHaveLength(2);
    expect((await alert).breakerId).toBe('p1');
    await waitForRedisState(gameId, (s) => s.diplomacy[0]?.status === 'neutral');
  });

  it('lets an atom bomb break a truce once confirmed, and spends nothing when refused', async () => {
    const gameId = 'itest-truce-bomb';
    const base = truceState(gameId, []);
    await seed(gameId, truceState(gameId, [], {
      era: 'ww2',
      players: [
        player('p1', 0, { territory_count: 1, legacy_ability_charges: { atom_bomb: 1 } }),
        ...base.players.slice(1),
      ],
    }), truceMap(gameId));
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    await expectTruceRefusal(client, gameId, 'game:use_ability', { abilityId: 'atom_bomb', params: { territoryId: 'b' } });
    const refused = await getGameState(gameId);
    expect(refused?.players[0]!.legacy_ability_charges).toEqual({ atom_bomb: 1 });
    expect(refused?.players[0]!.used_game_abilities ?? []).not.toContain('atom_bomb');

    const alert = waitForTruceBroken(partner, gameId);
    client.emit('game:use_ability', { gameId, abilityId: 'atom_bomb', params: { territoryId: 'b' }, breakTruce: true });
    expect((await alert).breakerId).toBe('p1');
    await waitForRedisState(gameId, (s) => s.territories.b.owner_id === null);
    expect(truceOf(await getGameState(gameId))).toEqual({ status: 'neutral', turns: 0 });
  });

  it('fires the atomic arsenal\'s bomb once per turn at its price, with fallout (WW2 Phase 3)', async () => {
    const gameId = 'itest-arsenal-bomb';
    const base = buildState(gameId, []);
    await seed(gameId, buildState(gameId, [], {
      era: 'ww2',
      players: [
        player('p1', 0, {
          territory_count: 1,
          unlocked_techs: ['ww2_motorization', 'ww2_tanks', 'ww2_panzer_tactics', 'ww2_atom_bomb'],
          special_resource: 30,
        }),
        ...base.players.slice(1),
      ],
      settings: { ...base.settings, tech_trees_enabled: true, economy_enabled: true, ww2_atomic_arsenal: true },
    }), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const result = waitFor<{ success: boolean; productionSpent?: number }>(client, 'game:ability_result');
    client.emit('game:use_ability', { gameId, abilityId: 'atom_bomb', params: { territoryId: 'c' } });
    expect(await result).toMatchObject({ success: true, productionSpent: 15 });
    await waitForRedisState(gameId, (s) => s.territories.c.owner_id === null);
    const after = await getGameState(gameId);
    expect(after?.territories.c.fallout_rounds).toBe(3);
    expect(after?.players[0]!.special_resource).toBe(15);
    expect(after?.players[0]!.atom_bomb_uses).toBe(1);
    expect(after?.players[0]!.used_game_abilities ?? []).not.toContain('atom_bomb');

    // Once per turn: the next one waits for the next turn, and spends nothing.
    const again = waitFor<{ message: string }>(client, 'error');
    client.emit('game:use_ability', { gameId, abilityId: 'atom_bomb', params: { territoryId: 'b' } });
    expect((await again).message).toMatch(/already used this turn/);
    expect((await getGameState(gameId))?.players[0]!.special_resource).toBe(15);
  });

  it('lets Influence seize a truce partner\'s territory once confirmed, breaking the truce', async () => {
    const gameId = 'itest-truce-influence';
    const base = truceState(gameId, []);
    await seed(gameId, truceState(gameId, [], {
      era: 'cold_war',
      era_modifiers: { influence_spread: true, influence_range: 1 },
      territories: { ...base.territories, a: terr('a', 'p1', 6) },
    }), truceMap(gameId));
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    await expectTruceRefusal(client, gameId, 'game:influence', { targetId: 'b' });

    const alert = waitForTruceBroken(partner, gameId);
    const result = waitFor<{ success: boolean; previousOwner: string }>(client, 'game:influence_result');
    client.emit('game:influence', { gameId, targetId: 'b', breakTruce: true });
    expect(await result).toMatchObject({ success: true, previousOwner: 'p2' });
    expect((await alert).breakerId).toBe('p1');
    await waitForRedisState(gameId, (s) => s.territories.b.owner_id === 'p1');
    expect(truceOf(await getGameState(gameId))).toEqual({ status: 'neutral', turns: 0 });
  });

  it('dates an accepted truce to its round, so its three rounds are the ones after it', async () => {
    const gameId = 'itest-truce-accept';
    await seed(gameId, buildState(gameId, [], {
      diplomacy: [{ player_index_a: 0, player_index_b: 1, status: 'neutral', truce_turns_remaining: 0 }],
      pending_truces: [{ proposer_id: 'p1', target_id: 'p2' }],
      settings: { ...buildState(gameId, []).settings, diplomacy_enabled: true },
    }), buildMap(gameId));
    const c2 = await connect('p2');
    await joinRoom('p2', gameId);

    c2.emit('game:truce_response', { gameId, proposerId: 'p1', accepted: true });
    await waitForRedisState(gameId, (s) => s.diplomacy[0]?.status === 'truce');
    expect((await getGameState(gameId))!.diplomacy[0]).toMatchObject({
      status: 'truce', truce_turns_remaining: 3, truce_agreed_turn: 3,
    });
  });

  // ── Events for one player name their game ───────────────────────────────────
  // They go to the player's user room, which every socket the player has open
  // receives, whichever game it shows. The page drops another game's.

  it('tells the target of a truce offer which game it comes from', async () => {
    const gameId = 'itest-truce-offer';
    await seed(gameId, buildState(gameId, [], {
      settings: { ...buildState(gameId, []).settings, diplomacy_enabled: true },
    }), buildMap(gameId));
    const client = await connect('p1');
    const partner = await connect('p2');
    await joinRoom('p1', gameId);

    const offer = waitFor<{ gameId: string; proposerId: string }>(
      partner, 'game:truce_proposal', 5_000, (o) => o.gameId === gameId,
    );
    client.emit('game:propose_truce', { gameId, targetPlayerId: 'p2' });
    expect(await offer).toMatchObject({ gameId, proposerId: 'p1', proposerName: 'P1' });
  });

  it('tells the player which game a coaching tip is for', async () => {
    const gameId = 'itest-coaching-tip';
    // p1 opens their draft holding a with one unit, beside p2's b: a thin border.
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 3,
      coaching_eligible: true,
      players: [player('p1', 0), player('p2', 1, { is_ai: true }), player('p3', 2, { is_ai: true })],
      territories: { a: terr('a', 'p1', 1), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
    }), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    // Turning coaching on in your own draft gives a tip at once.
    const tip = waitFor<{ category: string; gameId?: string }>(
      client, 'game:coaching_tip', 5_000, (t) => t.gameId === gameId,
    );
    client.emit('game:set_coaching', { gameId, enabled: true });
    expect(await tip).toMatchObject({ category: 'thin_border', gameId });
  });

  // ── Fog of War: map visuals must not leak hidden garrisons ─────────────────

  type Visual = { kind: string; territoryId: string; units?: number; totalAfter?: number; gameId?: string };

  /**
   * The next map visual from `gameId`. Under fog each player's copy goes to
   * their user room, like their state, so a visual names its game.
   */
  function waitForVisual(client: ClientSocket, gameId: string): Promise<Visual> {
    return waitFor<Visual>(client, 'game:map_visual', 5_000, (v) => v.gameId === gameId);
  }

  it('keeps a hidden reinforcement\'s totals from opponents who cannot see it under fog', async () => {
    const gameId = 'itest-fog-visual';
    // a–b–c chain: p2 (b) borders a and sees it; p3 (c) does not.
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 3,
      territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
      settings: { ...buildState(gameId, []).settings, fog_of_war: true },
    }), buildMap(gameId));
    const c1 = await connect('p1');
    const c2 = await connect('p2');
    const c3 = await connect('p3');
    for (const id of ['p1', 'p2', 'p3']) await joinRoom(id, gameId);

    const seen2 = waitForVisual(c2, gameId);
    const seen3 = waitForVisual(c3, gameId);
    c1.emit('game:draft', { gameId, territoryId: 'a', units: 2, action_id: 'fog1' });

    expect(await seen2).toMatchObject({ kind: 'reinforce', territoryId: 'a', units: 2, totalAfter: 4, gameId });
    const hidden = await seen3;
    expect(hidden).toMatchObject({ kind: 'reinforce', territoryId: 'a' });
    expect(hidden.units).toBeUndefined();
    expect(hidden.totalAfter).toBeUndefined();
  });

  it('keeps where a rival reinforced out of the state sent to players who cannot see it', async () => {
    const gameId = 'itest-fog-placements';
    // With Stability on, a draft keeps a per-territory tally for the cap.
    const stable = { stability: 80, population: 3 };
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 3,
      territories: { a: terr('a', 'p1', 2, stable), b: terr('b', 'p2', 1, stable), c: terr('c', 'p3', 5, stable) },
      settings: { ...buildState(gameId, []).settings, fog_of_war: true, stability_enabled: true },
    }), buildMap(gameId));
    const c1 = await connect('p1');
    const c3 = await connect('p3');
    for (const id of ['p1', 'p3']) await joinRoom(id, gameId);

    const own = waitForState(c1, gameId);
    const rival = waitForState(c3, gameId);
    c1.emit('game:draft', { gameId, territoryId: 'a', units: 2, action_id: 'fogtally1' });
    const [mine, theirs] = await Promise.all([own, rival]);
    // p3 (at c) cannot see a: the tile is masked, and so is the tally.
    expect({
      mine: mine.draft_placements_this_turn,
      hiddenTile: theirs.territories.a.unit_count,
      theirs: theirs.draft_placements_this_turn,
    }).toEqual({ mine: { a: 2 }, hiddenTile: -1, theirs: undefined });
  });

  it('shows bordering territories in fogged state before anything has built adjacency', async () => {
    // A fresh map id: nothing in this process has built its adjacency yet, and
    // ending a draft with no units left emits no visual that would build it.
    const gameId = 'itest-fog-cold-adjacency';
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 0,
      territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
      settings: { ...buildState(gameId, []).settings, fog_of_war: true },
    }), buildMap(gameId));
    const c1 = await connect('p1');
    await joinRoom('p1', gameId);

    const next = waitForState(c1, gameId);
    c1.emit('game:advance_phase', { gameId, action_id: 'cold1' });
    const view = await next;
    expect(view.phase).toBe('attack');
    // b borders p1's a: its garrison is scouted. c does not: it stays hidden.
    expect(view.territories.b.unit_count).toBe(1);
    expect(view.territories.c.unit_count).toBe(-1);
  });

  it('shows the tile across a lane one game has opened that another on its map has not', async () => {
    // Two games on one map id. A Launch Pad, a Jump Gate or a Surge Projector
    // opens a lane by replacing `map.connections`, so the second game's a–c
    // lane is on its own map only. p1 at a must see c across it there, and
    // not in the first game, whichever game's graph was built first.
    const mapId = 'itest-fog-lane-map';
    const plain = { ...buildMap('x'), map_id: mapId };
    const laned = { ...plain, connections: [...plain.connections, { from: 'a', to: 'c', type: 'orbit' }] } as GameMap;
    const c1 = await connect('p1');
    const sees = async (gameId: string, map: GameMap): Promise<number> => {
      await seed(gameId, buildState(gameId, [], {
        map_id: mapId,
        phase: 'draft', current_player_index: 0, draft_units_remaining: 0,
        territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
        settings: { ...buildState(gameId, []).settings, fog_of_war: true },
      }), map);
      await joinRoom('p1', gameId);
      const next = waitForState(c1, gameId);
      c1.emit('game:advance_phase', { gameId, action_id: `lane-${gameId}` });
      return (await next).territories.c.unit_count;
    };
    expect(await sees('itest-fog-lane-1', plain)).toBe(-1);
    expect(await sees('itest-fog-lane-2', laned)).toBe(5);
  });

  it('still shows everyone the totals when fog is off', async () => {
    const gameId = 'itest-nofog-visual';
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 3,
      territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
    }), buildMap(gameId));
    const c1 = await connect('p1');
    const c3 = await connect('p3');
    for (const id of ['p1', 'p3']) await joinRoom(id, gameId);

    const seen3 = waitForVisual(c3, gameId);
    c1.emit('game:draft', { gameId, territoryId: 'a', units: 2, action_id: 'nofog1' });
    expect(await seen3).toMatchObject({ kind: 'reinforce', territoryId: 'a', units: 2, totalAfter: 4 });
  });

  // ── Teams: no friendly fire, the opening ceasefire, shared vision ─────────

  const TEAMS = [
    { team_id: 'team_1', name: 'Us', player_ids: ['p1', 'p2'] },
    { team_id: 'team_2', name: 'Them', player_ids: ['p3'] },
  ];

  /** p1 and p2 are allies against p3, with no truce between anyone; p2 also holds `d`. */
  function teamState(gameId: string, overrides: Partial<GameState> = {}): GameState {
    return truceState(gameId, [], { diplomacy: [], teams: TEAMS, ...overrides } as Partial<GameState>);
  }

  async function expectRefusal(
    client: ClientSocket, gameId: string, event: string, payload: Record<string, unknown>,
    expected: { message: string; code: string },
  ): Promise<void> {
    const err = waitFor<{ message: string; code?: string }>(client, 'error');
    client.emit(event, { gameId, ...payload });
    expect(await err).toEqual(expected);
  }

  const ALLY_REFUSAL = { message: 'You cannot attack an ally', code: 'ALLY_TARGET' };

  it("refuses every attack on an ally's ground, and spends nothing", async () => {
    const gameId = 'itest-team-ally';
    const base = teamState(gameId);
    await seed(gameId, teamState(gameId, {
      era: 'ww2',
      era_modifiers: { influence_spread: true, influence_range: 1 },
      players: [
        player('p1', 0, { territory_count: 1, legacy_ability_charges: { atom_bomb: 1 } }),
        ...base.players.slice(1),
      ],
    }), truceMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    await expectRefusal(client, gameId, 'game:attack', { fromId: 'a', toId: 'b' }, ALLY_REFUSAL);
    await expectRefusal(client, gameId, 'game:attack_blitz', { fromId: 'a', toId: 'b' }, ALLY_REFUSAL);
    await expectRefusal(client, gameId, 'game:influence', { targetId: 'b' }, ALLY_REFUSAL);
    await expectRefusal(client, gameId, 'game:use_ability', { abilityId: 'atom_bomb', params: { territoryId: 'b' } }, ALLY_REFUSAL);
    const after = await getGameState(gameId);
    expect(after?.territories.b).toMatchObject({ owner_id: 'p2', unit_count: 1 });
    expect(after?.territories.a.unit_count).toBe(4);
    expect(after?.players[0]!.legacy_ability_charges).toEqual({ atom_bomb: 1 });
  });

  it("refuses a Fleet Attack on an ally's harbour before either fleet fights", async () => {
    const gameId = 'itest-team-fleet';
    const base = teamState(gameId);
    await seed(gameId, teamState(gameId, {
      territories: {
        ...base.territories,
        a: { ...terr('a', 'p1', 4), naval_units: 3 },
        b: { ...terr('b', 'p2', 1), naval_units: 1 },
      },
      settings: { ...base.settings, naval_enabled: true },
    }), { ...truceMap(gameId), connections: [{ from: 'a', to: 'b', type: 'sea' as const }] });
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    await expectRefusal(client, gameId, 'game:naval_attack', { fromId: 'a', toId: 'b' }, ALLY_REFUSAL);
    const after = await getGameState(gameId);
    expect(after?.territories.a).toMatchObject({ unit_count: 4, naval_units: 3 });
    expect(after?.territories.b).toMatchObject({ owner_id: 'p2', unit_count: 1, naval_units: 1 });
  });

  it('refuses an attack on the other side until every player has had a turn', async () => {
    const gameId = 'itest-team-ceasefire';
    const base = teamState(gameId);
    // b is the enemy's here; the game is in its first round.
    await seed(gameId, teamState(gameId, {
      turn_number: 1,
      territories: { ...base.territories, b: terr('b', 'p3', 1), c: terr('c', 'p2', 5) },
      players: [
        player('p1', 0, { territory_count: 1 }),
        player('p2', 1, { territory_count: 2 }),
        player('p3', 2, { territory_count: 1 }),
      ],
    }), truceMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    await expectRefusal(client, gameId, 'game:attack', { fromId: 'a', toId: 'b' }, {
      message: 'The opening ceasefire holds until every player has had a turn',
      code: 'CEASEFIRE',
    });
    expect((await getGameState(gameId))?.territories.b).toMatchObject({ owner_id: 'p3', unit_count: 1 });
  });

  it('shows a player whatever an ally sees under fog', async () => {
    const gameId = 'itest-team-fog';
    // p1 at a borders b; c is two tiles off. Allied with c's holder, p1 sees it.
    await seed(gameId, buildState(gameId, [], {
      phase: 'draft', current_player_index: 0, draft_units_remaining: 0,
      territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
      settings: { ...buildState(gameId, []).settings, fog_of_war: true },
      teams: [
        { team_id: 'team_1', name: 'Us', player_ids: ['p1', 'p3'] },
        { team_id: 'team_2', name: 'Them', player_ids: ['p2'] },
      ],
    } as Partial<GameState>), buildMap(gameId));
    const c1 = await connect('p1');
    await joinRoom('p1', gameId);

    const next = waitForState(c1, gameId);
    c1.emit('game:advance_phase', { gameId, action_id: 'teamfog1' });
    const view = await next;
    expect(view.territories.c.unit_count).toBe(5);
    expect(view.territories.b.unit_count).toBe(1);
  });

  // ── Draft undo (reinforcement placement reversal) ──────────────────────────

  function draftState(gameId: string, overrides: Partial<GameState> = {}): GameState {
    return buildState(gameId, [], {
      phase: 'draft',
      current_player_index: 0,
      draft_units_remaining: 3,
      territories: { a: terr('a', 'p1', 2), b: terr('b', 'p2', 1), c: terr('c', 'p3', 5) },
      ...overrides,
    });
  }

  it('undoes the last reinforcement placement, restoring units and the pool', async () => {
    const gameId = 'itest-draft-undo';
    await seed(gameId, draftState(gameId), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    client.emit('game:draft', { gameId, territoryId: 'a', units: 2, action_id: 'd1' });
    await waitForRedisState(gameId, (s) =>
      s.territories.a.unit_count === 4 && s.draft_units_remaining === 1 &&
      (s.draft_deployments_this_turn?.length ?? 0) === 1);

    client.emit('game:draft_undo', { gameId, action_id: 'u1' });
    await waitForRedisState(gameId, (s) =>
      s.territories.a.unit_count === 2 && s.draft_units_remaining === 3 &&
      (s.draft_deployments_this_turn?.length ?? 0) === 0);
  });

  it('undoes only the most recent placement when several were made', async () => {
    const gameId = 'itest-draft-undo-last';
    await seed(gameId, draftState(gameId), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    client.emit('game:draft', { gameId, territoryId: 'a', units: 1, action_id: 'd1' });
    await waitForRedisState(gameId, (s) => s.territories.a.unit_count === 3);
    client.emit('game:draft', { gameId, territoryId: 'a', units: 1, action_id: 'd2' });
    await waitForRedisState(gameId, (s) =>
      s.territories.a.unit_count === 4 && (s.draft_deployments_this_turn?.length ?? 0) === 2);

    client.emit('game:draft_undo', { gameId, action_id: 'u1' });
    await waitForRedisState(gameId, (s) =>
      s.territories.a.unit_count === 3 && s.draft_units_remaining === 2 &&
      (s.draft_deployments_this_turn?.length ?? 0) === 1);
  });

  it('rejects draft undo when there is nothing to undo', async () => {
    const gameId = 'itest-draft-undo-empty';
    await seed(gameId, draftState(gameId), buildMap(gameId));
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string }>(client, 'error');
    client.emit('game:draft_undo', { gameId, action_id: 'u1' });
    expect((await err).message).toBe('Nothing to undo');
  });

  it('rejects draft undo outside the draft phase', async () => {
    const gameId = 'itest-draft-undo-phase';
    await seed(gameId, buildState(gameId, []), buildMap(gameId)); // default phase: 'attack'
    const client = await connect('p1');
    await joinRoom('p1', gameId);

    const err = waitFor<{ message: string }>(client, 'error');
    client.emit('game:draft_undo', { gameId, action_id: 'u1' });
    expect((await err).message).toBe('Not in draft phase');
  });
});

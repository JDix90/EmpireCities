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
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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
    // Closes the socket.io server + its Redis adapter + the BullMQ workers.
    // The shared `redis` singleton is intentionally left open (matching
    // redisGameStore.test.ts) so sibling Redis-tier files aren't disconnected.
    await shutdownGameSocket(ioServer).catch(() => { /* worker teardown best-effort */ });
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

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
   * 3-player domination game in the attack phase, p1 (current) on territory `a`
   * adjacent to p2's `b`; p3 holds `c` (so eliminating p2 never ends the game).
   * `dice` seeds the deterministic combat roll: all attacker dice, then defender.
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
      era_modifiers: {}, // explicit: avoid the Ancient legion_reroll repair patch
      puzzle_dice_queue: dice,
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

  function waitFor<T = unknown>(client: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => { clearTimeout(t); resolve(payload); });
    });
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
    const stateEvt = waitFor<GameState>(client, 'game:state');
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
    const stateEvt = waitFor<GameState>(client, 'game:state');
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

    const firstState = waitFor<GameState>(client, 'game:state');
    client.emit('game:attack', { gameId, fromId: 'a', toId: 'b' });
    await firstState;
    // The first attack persists fire-and-forget; wait for it before reloading.
    await waitForRedisState(gameId, (s) => s.territories.b.owner_id === 'p1');

    const secondState = waitFor<GameState>(client, 'game:state');
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

    const result = waitFor<{ fromId: string; toId: string; units: number }>(client, 'game:fortify_result');
    client.emit('game:fortify', { gameId, fromId: 'a', toId: 'b', units: 2 });

    expect(await result).toEqual({ fromId: 'a', toId: 'b', units: 2 });
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

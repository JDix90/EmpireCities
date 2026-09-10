/**
 * Galactic Age hyperspace rules over the real wire, on era_galaxy.json.
 *
 * Exercises corridors (no tech gate; positional access), the kill switch (the
 * old Hyperspace Chart gate), the Void Custodians' Emergency Seal (block, own
 * crossing, once per turn, lifts at the sealer's next turn), the faction
 * abilities, the territory-selection defect the create boundary now rejects,
 * and the Hyperlane Anchor wonder under the kill switch.
 *
 *   redis-server --port 6399 --save '' --appendonly no --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6399 \
 *     pnpm exec vitest run src/sockets/galacticAgeHyperspaceSocket.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IOServer } from 'socket.io';
import { io as ClientIO, type Socket as ClientSocket } from 'socket.io-client';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameState, GameMap, GameSettings } from '../types';
import { initializeGameState } from '../game-engine/state/gameStateManager';
import { orbitLaneId } from '../game-engine/state/moonAccess';

const redisTestEnabled = process.env.REDIS_TEST === '1';

// Seat order == faction order below; homeworld distribution gives each seat its world.
const P = ['ga_lane_p1', 'ga_lane_p2', 'ga_lane_p3', 'ga_lane_p4'] as const;
const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
// Authored lanes used below.
const L1 = { sol: 'sol_guinea', verdan: 'verdan_chlorophage_span' };
const DENY = 'Hyperspace travel requires: Lane Charts tech';
/** Kill-switch settings: the classic Chart gate, no lane cap. */
const GATED = { galaxy_corridors_enabled: false } as unknown as Partial<GameSettings>;
// Lanes touching Nexus Station (Custodians' world), for Emergency Seal.
const N1 = { sol: 'sol_amazonia', nexus: 'nexus_harmonic_rim' };
const N2 = { sol: 'sol_cathay', nexus: 'nexus_resonance_vault' };

describe.runIf(redisTestEnabled)('Galactic Age hyperspace — human socket path', () => {
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
  const AUTHORED = JSON.parse(readFileSync(join(__dirname, '../../../database/maps/era_galaxy.json'), 'utf-8')) as GameMap;

  beforeAll(async () => {
    const sockets = await import('./gameSocket');
    shutdownGameSocket = sockets.shutdownGameSocket;
    ({ signAccessToken } = await import('../utils/jwt'));
    const store = await import('./redisGameStore');
    setGameState = store.setGameState; getGameState = store.getGameState;
    setGameMap = store.setGameMap; deleteGameKeys = store.deleteGameKeys;
    const redisMod = await import('../db/redis');
    await redisMod.redis.connect().catch(() => { /* lazyConnect */ });
    httpServer = createServer();
    ioServer = sockets.initGameSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    for (const c of openClients) c.disconnect();
    await shutdownGameSocket(ioServer).catch(() => {});
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }, 30_000);

  afterEach(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    for (const id of createdGames.splice(0)) await deleteGameKeys(id).catch(() => {});
  });

  function freshMap(): GameMap { return JSON.parse(JSON.stringify(AUTHORED)) as GameMap; }

  function settings(extra: Partial<GameSettings> = {}): GameSettings {
    return {
      fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
      diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
      economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
      era_advancement_enabled: false, galaxy_corridors_enabled: true,
      // Worlds-as-characters rules are off here: this suite exercises the
      // corridors on the classic four-homeworld start. The Vault case below
      // turns them on for itself.
      world_rules_enabled: false,
      allowed_victory_conditions: ['domination', 'threshold'], victory_type: 'domination',
      victory_threshold: 60, max_turns: 90, ...extra,
    } as unknown as GameSettings;
  }

  function freshState(gameId: string, map: GameMap, extra: Partial<GameSettings> = {}): GameState {
    const players = P.map((id, i) => ({
      player_id: id, player_index: i, username: id.toUpperCase(), color: ['#c0392b', '#e67e22', '#2ecc71', '#9b59b6'][i],
      is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
    }));
    const state = initializeGameState(gameId, 'galaxy_age', map, players, settings(extra), { forceStartingPlayerIndex: 0 });
    state.map_id = gameId;
    return state;
  }

  async function seed(gameId: string, state: GameState, map: GameMap): Promise<void> {
    await setGameState(gameId, state); await setGameMap(gameId, map); createdGames.push(gameId);
  }

  async function connect(userId: string): Promise<ClientSocket> {
    const token = signAccessToken({ sub: userId, username: userId.toUpperCase() });
    const client = ClientIO(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
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

  type ActResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
  function act<T = unknown>(client: ClientSocket, event: string, payload: object, okEvent: string): Promise<ActResult<T>> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout on ${event}`)), 10_000);
      const onOk = (data: T) => { cleanup(); resolve({ ok: true, data }); };
      const onErr = (e: { message: string; code?: string }) => { cleanup(); resolve({ ok: false, error: e.message, code: e.code }); };
      const cleanup = () => { clearTimeout(t); client.off(okEvent, onOk); client.off('error', onErr); };
      client.on(okEvent, onOk); client.on('error', onErr);
      client.emit(event, payload);
    });
  }

  async function waitForRedisState(gameId: string, predicate: (s: GameState) => boolean): Promise<GameState> {
    for (let i = 0; i < 300; i++) {
      const s = await getGameState(gameId);
      if (s && predicate(s)) return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for persisted Redis state');
  }

  /**
   * Attack-phase setup: attacker tile stacked, defender tile thinned, dice
   * fixed so one exchange captures. Two sixes then ones: a lane crossing rolls
   * two attacker dice under corridors (three with the kill switch off), and a
   * one-unit defender rolls one, so either way the high die is a six against a
   * one. A long tail keeps createPuzzleDieRoll from falling back to CSPRNG.
   */
  function armAssault(state: GameState, from: string, to: string): void {
    state.territories[from].unit_count = 12;
    state.territories[to].unit_count = 1;
    state.puzzle_dice_queue = [6, 6, ...Array(40).fill(1)];
  }

  async function endTurn(client: ClientSocket, gameId: string, fromPhase: 'draft' | 'attack' | 'fortify'): Promise<void> {
    const hops = fromPhase === 'draft' ? 3 : fromPhase === 'attack' ? 2 : 1;
    for (let i = 0; i < hops; i++) {
      const r = await act(client, 'game:advance_phase', { gameId }, 'game:state');
      expect(r.ok, r.ok ? '' : `advance_phase: ${r.error}`).toBe(true);
    }
  }

  it('crosses a lane with no tech at all under corridors — access is positional', async () => {
    const gameId = 'itest-ga-corridor';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.players[0].unlocked_techs = [];
    armAssault(state, L1.sol, L1.verdan);
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const r = await act<{ result: { territory_captured: boolean; attacker_dice?: number[] } }>(
      c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result',
    );
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) {
      expect(r.data.result.territory_captured).toBe(true);
      // The lane cap: two attacker dice without Lane Charts.
      expect(r.data.result.attacker_dice?.length ?? 2).toBeLessThanOrEqual(2);
    }
  }, 30_000);

  it('with the kill switch off, the Hyperspace Chart gate still refuses and names the tech', async () => {
    const gameId = 'itest-ga-gate';
    const map = freshMap(); const state = freshState(gameId, map, GATED);
    state.phase = 'attack';
    armAssault(state, L1.sol, L1.verdan);
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const denied = await act(c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    expect(denied.ok).toBe(false);
    if (!denied.ok) { expect(denied.code).toBe('ACCESS_DENIED'); expect(denied.error).toBe(DENY); }
  }, 30_000);

  it('with the kill switch off, the crossing opens once the Chart is researched', async () => {
    const gameId2 = 'itest-ga-gate-open';
    const map2 = freshMap(); const s2 = freshState(gameId2, map2, GATED);
    s2.phase = 'attack'; s2.players[0].unlocked_techs = ['ga_hyperspace_chart'];
    armAssault(s2, L1.sol, L1.verdan);
    await seed(gameId2, s2, map2);
    const c2 = await connect(P[0]); await joinRoom(P[0], gameId2);
    const ok = await act<{ result: { territory_captured: boolean } }>(c2, 'game:attack', { gameId: gameId2, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    if (ok.ok) expect(ok.data.result.territory_captured).toBe(true);
    const after = await waitForRedisState(gameId2, (s) => s.territories[L1.verdan].owner_id === P[0]);
    expect(after.territories[L1.verdan].owner_id).toBe(P[0]);
  }, 60_000);

  it('Lane Charts is affordable on turn 1 by every faction (why the old gate gated nothing)', async () => {
    const gameId = 'itest-ga-chart-t1';
    const map = freshMap(); const state = freshState(gameId, map);
    // Opening economy tick as the real create path applies it.
    const { applyOpeningEconomyTick } = await import('../game-engine/state/gameStateManager');
    applyOpeningEconomyTick(state);
    const tp = state.players.map((p) => p.tech_points ?? 0);
    console.log('[chart t1] starting tech points per seat', tp);
    for (const p of state.players) expect(p.tech_points ?? 0).toBeGreaterThanOrEqual(5);
    state.phase = 'draft'; state.draft_units_remaining = 0;
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const r = await act(c, 'game:research_tech', { gameId, techId: 'ga_hyperspace_chart' }, 'game:research_result');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  }, 30_000);

  it('Helion Navigators cross a lane with no tech at all', async () => {
    const gameId = 'itest-ga-helion';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.current_player_index = 2;
    armAssault(state, L1.verdan, L1.sol);
    await seed(gameId, state, map);
    const c = await connect(P[2]); await joinRoom(P[2], gameId);
    const r = await act<{ result: { territory_captured: boolean } }>(c, 'game:attack', { gameId, fromId: L1.verdan, toId: L1.sol }, 'game:combat_result');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(r.data.result.territory_captured).toBe(true);
  }, 30_000);

  it('The Vault: the Gate Ring starts neutral, and whoever holds all four tiles may seal ANY lane', async () => {
    const gameId = 'itest-ga-vault';
    const map = freshMap();
    const state = freshState(gameId, map, { world_rules_enabled: true } as unknown as Partial<GameSettings>);
    const ring = map.territories.filter((t) => t.region_id === 'nexus_gate_ring').map((t) => t.territory_id);
    expect(ring).toHaveLength(4);
    for (const tid of ring) {
      expect(state.territories[tid].owner_id).toBeNull();
      expect(state.territories[tid].unit_count).toBe(6);
    }
    expect(Object.values(state.territories).filter((t) => t.owner_id === P[3])).toHaveLength(12);
    // Hand the ring to the Mandate: the Vault is theirs now.
    for (const tid of ring) { state.territories[tid].owner_id = P[0]; state.territories[tid].unit_count = 3; }
    state.phase = 'attack'; state.current_player_index = 0;
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);

    const seal = await act(c, 'game:seal_lane', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:state');
    expect(seal.ok, seal.ok ? '' : seal.error).toBe(true);
    const sealed = await waitForRedisState(gameId, (s) => !!s.lane_blockades?.[orbitLaneId(L1.sol, L1.verdan)]);
    expect(sealed.lane_blockades![orbitLaneId(L1.sol, L1.verdan)]).toEqual({ owner_id: P[0], turns_remaining: 1 });
    // One charge a turn, Vault or not.
    const twice = await act(c, 'game:seal_lane', { gameId, fromId: N1.sol, toId: N1.nexus }, 'game:state');
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toMatch(/already used/);
  }, 30_000);

  it('Emergency Seal: Custodians close a Nexus lane; it blocks the rival on that lane only, once per turn, and lifts at their next turn', async () => {
    const gameId = 'itest-ga-seal';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.current_player_index = 3;
    // Sol's Mandate is armed to cross both Nexus lanes; Nexus tiles thinned.
    state.territories[N1.sol].unit_count = 12; state.territories[N1.nexus].unit_count = 1;
    state.territories[N2.sol].unit_count = 12; state.territories[N2.nexus].unit_count = 1;
    state.puzzle_dice_queue = [6, 6, ...Array(40).fill(1)];
    await seed(gameId, state, map);
    const cs = await Promise.all(P.map(async (id) => { const c = await connect(id); await joinRoom(id, gameId); return c; }));
    const log: string[] = [];

    // Not a Custodian: refused by faction.
    const notMine = await act(cs[0], 'game:seal_lane', { gameId, fromId: N1.sol, toId: N1.nexus }, 'game:state');
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) { expect(notMine.error).toMatch(/Not your turn|Void Custodians/); log.push(`P1 seal → ${notMine.error}`); }

    // Custodians: a lane that does not touch Nexus is refused.
    const wrongLane = await act(cs[3], 'game:seal_lane', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:state');
    expect(wrongLane.ok).toBe(false);
    if (!wrongLane.ok) { expect(wrongLane.error).toMatch(/touch Nexus Station/); log.push(`P4 seal Sol–Verdan → ${wrongLane.error}`); }

    const seal = await act(cs[3], 'game:seal_lane', { gameId, fromId: N1.nexus, toId: N1.sol }, 'game:state');
    expect(seal.ok, seal.ok ? '' : seal.error).toBe(true);
    const sealed = await waitForRedisState(gameId, (s) => !!s.lane_blockades?.[orbitLaneId(N1.sol, N1.nexus)]);
    expect(sealed.lane_blockades![orbitLaneId(N1.sol, N1.nexus)]).toEqual({ owner_id: P[3], turns_remaining: 1 });
    log.push('P4 sealed N1');

    const twice = await act(cs[3], 'game:seal_lane', { gameId, fromId: N2.nexus, toId: N2.sol }, 'game:state');
    expect(twice.ok).toBe(false);
    if (!twice.ok) { expect(twice.error).toMatch(/already used this turn/); log.push(`P4 second seal → ${twice.error}`); }

    // Custodians end their turn; the round wraps to P1. The seal must survive
    // the wrap — it ages at the SEALER's next turn, not the round boundary.
    await endTurn(cs[3], gameId, 'attack');
    const afterWrap = await waitForRedisState(gameId, (s) => s.current_player_index === 0 && s.phase === 'draft');
    expect(afterWrap.lane_blockades?.[orbitLaneId(N1.sol, N1.nexus)]?.turns_remaining).toBe(1);
    expect((await act(cs[0], 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'attack');

    const blocked = await act(cs[0], 'game:attack', { gameId, fromId: N1.sol, toId: N1.nexus }, 'game:combat_result');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) { expect(blocked.code).toBe('LANE_SEALED'); log.push(`P1 across sealed N1 → ${blocked.error}`); }

    const sister = await act<{ result: { territory_captured: boolean } }>(cs[0], 'game:attack', { gameId, fromId: N2.sol, toId: N2.nexus }, 'game:combat_result');
    expect(sister.ok, sister.ok ? '' : sister.error).toBe(true);
    if (sister.ok) log.push(`P1 across sister lane N2 → captured ${sister.data.result.territory_captured}`);

    // P1, P2, P3 finish; when P4's turn begins the seal has aged out.
    await endTurn(cs[0], gameId, 'attack');
    await waitForRedisState(gameId, (s) => s.current_player_index === 1);
    await endTurn(cs[1], gameId, 'draft');
    await waitForRedisState(gameId, (s) => s.current_player_index === 2);
    await endTurn(cs[2], gameId, 'draft');
    const lifted = await waitForRedisState(gameId, (s) => s.current_player_index === 3);
    expect(lifted.lane_blockades ?? {}).toEqual({});
    log.push('seal lifted as P4 came back round');
    console.log('\n[emergency seal]\n' + log.join('\n'));
  }, 120_000);

  it('the sealer crosses their own seal', async () => {
    const gameId = 'itest-ga-own-seal';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.current_player_index = 3;
    state.lane_blockades = { [orbitLaneId(N1.sol, N1.nexus)]: { owner_id: P[3], turns_remaining: 1 } };
    armAssault(state, N1.nexus, N1.sol);
    await seed(gameId, state, map);
    const c = await connect(P[3]); await joinRoom(P[3], gameId);
    const r = await act<{ result: { territory_captured: boolean } }>(c, 'game:attack', { gameId, fromId: N1.nexus, toId: N1.sol }, 'game:combat_result');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  }, 30_000);

  it('faction abilities over the wire: what each of the four actually does today', async () => {
    const log: string[] = [];
    // Helion — Long-Range Sensors is a PASSIVE now (gateway visibility under
    // fog). The old `orbital_recon` active had no handler in any era, so it is
    // gone: the faction offers no activatable ability at all.
    {
      const gameId = 'itest-ga-abil-helion';
      const map = freshMap(); const state = freshState(gameId, map);
      state.phase = 'attack'; state.current_player_index = 2;
      await seed(gameId, state, map);
      const c = await connect(P[2]); await joinRoom(P[2], gameId);
      const r = await act(c, 'game:use_ability', { gameId, abilityId: 'orbital_recon', params: { territoryId: L1.sol } }, 'game:ability_result');
      log.push(`helion orbital_recon → ${r.ok ? 'OK' : 'ERROR ' + r.error}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not available to you/i);
    }
    // Forge — Supply Insert (guerrilla_warfare), draft phase, own tile
    {
      const gameId = 'itest-ga-abil-forge';
      const map = freshMap(); const state = freshState(gameId, map);
      state.phase = 'draft'; state.current_player_index = 1; state.draft_units_remaining = 0;
      const own = Object.values(state.territories).find((t) => t.owner_id === P[1])!;
      const before = own.unit_count;
      await seed(gameId, state, map);
      const c = await connect(P[1]); await joinRoom(P[1], gameId);
      const r = await act(c, 'game:use_ability', { gameId, abilityId: 'guerrilla_warfare', params: { territoryId: own.territory_id } }, 'game:ability_result');
      const s = await getGameState(gameId);
      log.push(`forge guerrilla_warfare → ${r.ok ? 'OK' : 'ERROR ' + r.error}; units ${before} → ${s!.territories[own.territory_id].unit_count}`);
      expect(r.ok).toBe(true);
    }
    // Custodians — the old terraform charge is gone; Emergency Seal lives on
    // game:seal_lane and is covered above.
    {
      const gameId = 'itest-ga-abil-void';
      const map = freshMap(); const state = freshState(gameId, map, { stability_enabled: true } as Partial<GameSettings>);
      state.phase = 'draft'; state.current_player_index = 3; state.draft_units_remaining = 0;
      const own = Object.values(state.territories).find((t) => t.owner_id === P[3])!;
      await seed(gameId, state, map);
      const c = await connect(P[3]); await joinRoom(P[3], gameId);
      const r = await act(c, 'game:use_ability', { gameId, abilityId: 'terraform', params: { territoryId: own.territory_id } }, 'game:ability_result');
      log.push(`void terraform → ${r.ok ? 'OK' : 'ERROR ' + r.error}`);
      expect(r.ok).toBe(false);
    }
    // Mandate — Blockade Runner: the next lane crossing ignores an Emergency Seal.
    {
      const gameId = 'itest-ga-abil-mandate';
      const map = freshMap(); const state = freshState(gameId, map);
      state.phase = 'attack'; state.current_player_index = 0;
      state.lane_blockades = { [orbitLaneId(N1.sol, N1.nexus)]: { owner_id: P[3], turns_remaining: 1 } };
      armAssault(state, N1.sol, N1.nexus);
      await seed(gameId, state, map);
      const c = await connect(P[0]); await joinRoom(P[0], gameId);
      const blocked = await act(c, 'game:attack', { gameId, fromId: N1.sol, toId: N1.nexus }, 'game:combat_result');
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe('LANE_SEALED');
      const arm = await act(c, 'game:use_ability', { gameId, abilityId: 'blockade_runner' }, 'game:ability_result');
      expect(arm.ok, arm.ok ? '' : arm.error).toBe(true);
      const through = await act<{ result: { territory_captured: boolean } }>(c, 'game:attack', { gameId, fromId: N1.sol, toId: N1.nexus }, 'game:combat_result');
      log.push(`mandate blockade_runner across sealed N1 → ${through.ok ? 'OK captured ' + through.data.result.territory_captured : 'ERROR ' + through.error}`);
      expect(through.ok).toBe(true);
    }
    // Helion — Drift Jump: fortify between two owned gateways on different
    // worlds with no connecting route, once per turn.
    {
      const gameId = 'itest-ga-abil-helion-drift';
      const map = freshMap(); const state = freshState(gameId, map);
      state.phase = 'fortify'; state.current_player_index = 2;
      // Helion holds its own Verdan gateway and a beachhead gateway on Rust
      // whose lane runs to Nexus, not Verdan — so no owned route joins them.
      // (rust_anvil_basin would NOT do: its lane ends on Helion's own
      // verdan_photic_crown, which makes an ordinary corridor fortify.)
      const verdanGate = 'verdan_chlorophage_span';
      const rustGate = 'rust_hematite_span';
      state.territories[verdanGate].owner_id = P[2]; state.territories[verdanGate].unit_count = 9;
      state.territories[rustGate].owner_id = P[2]; state.territories[rustGate].unit_count = 2;
      await seed(gameId, state, map);
      const c = await connect(P[2]); await joinRoom(P[2], gameId);
      const jump = await act(c, 'game:fortify', { gameId, fromId: verdanGate, toId: rustGate, units: 4 }, 'game:fortify_result');
      log.push(`helion drift_jump verdan→rust gateway → ${jump.ok ? 'OK' : 'ERROR ' + jump.error}`);
      expect(jump.ok, jump.ok ? '' : jump.error).toBe(true);
      const after = await waitForRedisState(gameId, (s) => s.territories[rustGate].unit_count === 6);
      expect(after.territories[verdanGate].unit_count).toBe(5);
      expect(after.players[2].ability_uses?.drift_jump).toBe(1);
    }
    console.log('\n[faction abilities]\n' + log.join('\n'));
  }, 120_000);

  // Territory Draft is rejected for galaxy maps at the create boundary
  // (territorySelectionRejection). This case pins the reason: the exo tiles
  // arrive neutral with zero units, which no attack can ever resolve against.
  it('territory selection leaves every off-world tile neutral with no garrison', async () => {
    const gameId = 'itest-ga-select';
    const map = freshMap(); const state = freshState(gameId, map, { territory_selection: true, ...GATED } as Partial<GameSettings>);
    expect(state.phase).toBe('territory_select');
    const neutralExo = Object.values(state.territories).filter((t) => t.world_id !== 'sol');
    const zeroUnit = neutralExo.filter((t) => t.owner_id == null && t.unit_count === 0).length;
    console.log(`[select] exo tiles neutral with 0 units at init: ${zeroUnit} of ${neutralExo.length}`);
    expect(zeroUnit).toBe(neutralExo.length);
    await seed(gameId, state, map);
    const c1 = await connect(P[0]); await joinRoom(P[0], gameId);
    const c2 = await connect(P[1]); await joinRoom(P[1], gameId);
    const c3 = await connect(P[2]); await joinRoom(P[2], gameId);

    const mandateExo = await act(c1, 'game:select_territory', { gameId, territoryId: L1.verdan }, 'game:state');
    expect(mandateExo.ok).toBe(false);
    if (!mandateExo.ok) expect(mandateExo.error).toBe(DENY);
    expect((await act(c1, 'game:select_territory', { gameId, territoryId: 'sol_columbia' }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.current_player_index === 1);
    expect((await act(c2, 'game:select_territory', { gameId, territoryId: 'sol_amazonia' }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.current_player_index === 2);
    const helionExo = await act(c3, 'game:select_territory', { gameId, territoryId: L1.verdan }, 'game:state');
    expect(helionExo.ok, helionExo.ok ? '' : helionExo.error).toBe(true);
    const after = await waitForRedisState(gameId, (s) => s.territories[L1.verdan].owner_id === P[2]);
    expect(after.territories[L1.verdan].owner_id).toBe(P[2]);
  }, 60_000);

  it('a zero-unit neutral exo tile (selection-mode leftover) — what happens when someone with the chart attacks it', async () => {
    const gameId = 'itest-ga-zero-neutral';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.players[0].unlocked_techs = ['ga_hyperspace_chart'];
    state.territories[L1.sol].unit_count = 12;
    state.territories[L1.verdan].owner_id = null; state.territories[L1.verdan].unit_count = 0;
    state.puzzle_dice_queue = [6, 6, 6, ...Array(40).fill(1)];
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const r = await act<{ result: { territory_captured: boolean; defender_losses?: number } }>(c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    const s = await getGameState(gameId);
    console.log(`[zero-neutral] attack → ${r.ok ? 'OK ' + JSON.stringify(r.data.result) : 'ERROR ' + r.error}; owner now ${s!.territories[L1.verdan].owner_id} units ${s!.territories[L1.verdan].unit_count}`);
    // Untakeable by anyone: executeLandAttack refuses a defender below 1 unit.
    expect(r.ok).toBe(false);
    expect(s!.territories[L1.verdan].owner_id).toBeNull();
  }, 30_000);

  it('with the kill switch off, the Hyperlane Anchor wonder grants lane access with no tech', async () => {
    const gameId = 'itest-ga-anchor';
    const map = freshMap(); const state = freshState(gameId, map, GATED);
    state.phase = 'draft'; state.draft_units_remaining = 0;
    state.players[0].special_resource = 22; state.players[0].unlocked_techs = [];
    armAssault(state, L1.sol, L1.verdan);
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const build = await act(c, 'game:build', { gameId, territoryId: L1.sol, buildingType: 'wonder_hyperlane_anchor' }, 'game:build_result');
    expect(build.ok, build.ok ? '' : build.error).toBe(true);
    expect((await act(c, 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'attack');
    const r = await act<{ result: { territory_captured: boolean } }>(c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(r.data.result.territory_captured).toBe(true);
  }, 45_000);

  it('a pair of Jump Gates opens a private lane that moves units but carries no attack', async () => {
    const gameId = 'itest-ga-jumpgate';
    const map = freshMap();
    const state = freshState(gameId, map);
    state.phase = 'draft'; state.draft_units_remaining = 0;
    // The Mandate holds a Sol tile and a Rust beachhead, with the tech and the PP.
    const SOL_GATE = 'sol_columbia';
    const RUST_GATE = 'rust_cinderworks';
    state.territories[RUST_GATE].owner_id = P[0];
    state.territories[SOL_GATE].unit_count = 9;
    state.territories[RUST_GATE].unit_count = 2;
    state.players[0].special_resource = 60;
    state.players[0].unlocked_techs = ['ga_lattice_logistics', 'ga_gate_engineering'];
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);

    const first = await act(c, 'game:build', { gameId, territoryId: SOL_GATE, buildingType: 'jump_gate' }, 'game:build_result');
    expect(first.ok, first.ok ? '' : first.error).toBe(true);
    const second = await act(c, 'game:build', { gameId, territoryId: RUST_GATE, buildingType: 'jump_gate' }, 'game:build_result');
    expect(second.ok, second.ok ? '' : second.error).toBe(true);

    // A second gate on the same world is refused.
    const dupe = await act(c, 'game:build', { gameId, territoryId: 'rust_oxide_flats', buildingType: 'jump_gate' }, 'game:build_result');
    expect(dupe.ok).toBe(false);

    const withLane = await waitForRedisState(gameId, (st) => (st.jump_gate_links?.length ?? 0) > 0);
    expect(withLane.jump_gate_links).toEqual([{ a: RUST_GATE, b: SOL_GATE }]);

    // Hand the far end to a rival and try to invade down the private lane.
    const armed = await getGameState(gameId);
    armed!.territories[RUST_GATE].owner_id = P[1];
    armed!.territories[RUST_GATE].unit_count = 1;
    armed!.phase = 'attack';
    await setGameState(gameId, armed!);
    const attack = await act(c, 'game:attack', { gameId, fromId: SOL_GATE, toId: RUST_GATE }, 'game:combat_result');
    expect(attack.ok).toBe(false);
    if (!attack.ok) expect(attack.error).toMatch(/cannot carry an attack/);
  }, 45_000);
});

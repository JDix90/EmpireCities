/**
 * Galactic Age hyperspace rules over the real wire, on era_galaxy.json.
 *
 * Probe spec written during the Galactic Age review: exercises the orbit gate,
 * Helion's free lanes, contestable lane seals (block, own-crossing, one-per-
 * player, expiry on round wrap), the four faction abilities, territory-selection
 * mode on a locked world, and the Hyperlane Anchor wonder. Some cases document
 * CURRENT behaviour that the review flags as a defect — they are labelled.
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
const L2 = { sol: 'sol_pacific_rim', verdan: 'verdan_greenfire_vault' };
const DENY = 'Hyperspace travel requires: Hyperspace Chart tech';

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
      era_advancement_enabled: false, lanes_contestable_enabled: true,
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

  /** Attack-phase setup: attacker tile stacked, defender tile thinned, dice fixed so one exchange captures. */
  function armAssault(state: GameState, from: string, to: string): void {
    state.territories[from].unit_count = 12;
    state.territories[to].unit_count = 1;
    state.puzzle_dice_queue = [6, 6, 6, ...Array(40).fill(1)];
  }

  async function endTurn(client: ClientSocket, gameId: string, fromPhase: 'draft' | 'attack' | 'fortify'): Promise<void> {
    const hops = fromPhase === 'draft' ? 3 : fromPhase === 'attack' ? 2 : 1;
    for (let i = 0; i < hops; i++) {
      const r = await act(client, 'game:advance_phase', { gameId }, 'game:state');
      expect(r.ok, r.ok ? '' : `advance_phase: ${r.error}`).toBe(true);
    }
  }

  it('refuses a lane crossing before Hyperspace Chart, names the tech, and allows it once researched', async () => {
    const gameId = 'itest-ga-gate';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'draft'; state.draft_units_remaining = 0;
    state.players[0].tech_points = 10;
    armAssault(state, L1.sol, L1.verdan);
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);

    expect((await act(c, 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'attack');
    const denied = await act(c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    expect(denied.ok).toBe(false);
    if (!denied.ok) { expect(denied.code).toBe('ACCESS_DENIED'); expect(denied.error).toBe(DENY); }

  }, 30_000);

  it('allows the same crossing once Hyperspace Chart is researched', async () => {
    const gameId2 = 'itest-ga-gate-open';
    const map2 = freshMap(); const s2 = freshState(gameId2, map2);
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

  it('Hyperspace Chart is affordable on turn 1 by every faction (the "race" is zero turns long)', async () => {
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

  it('a seal blocks the rival on that one lane, not the sealer and not the sister lane; one seal per player', async () => {
    const gameId = 'itest-ga-seal';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.current_player_index = 0;
    state.players[0].unlocked_techs = ['ga_hyperspace_chart'];
    // Helion's assault tiles armed for later; Sol tiles thinned to be capturable.
    state.territories[L1.verdan].unit_count = 12; state.territories[L1.sol].unit_count = 1;
    state.territories[L2.verdan].unit_count = 12; state.territories[L2.sol].unit_count = 1;
    state.puzzle_dice_queue = [6, 6, 6, ...Array(40).fill(1)];
    await seed(gameId, state, map);
    const c1 = await connect(P[0]); await joinRoom(P[0], gameId);
    const c2 = await connect(P[1]); await joinRoom(P[1], gameId);
    const c3 = await connect(P[2]); await joinRoom(P[2], gameId);
    const log: string[] = [];

    const seal = await act(c1, 'game:seal_lane', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:state');
    expect(seal.ok, seal.ok ? '' : seal.error).toBe(true);
    const sealed = await waitForRedisState(gameId, (s) => !!s.lane_blockades?.[orbitLaneId(L1.sol, L1.verdan)]);
    expect(sealed.lane_blockades![orbitLaneId(L1.sol, L1.verdan)]).toEqual({ owner_id: P[0], turns_remaining: 3 });
    log.push('P1 sealed L1');

    const second = await act(c1, 'game:seal_lane', { gameId, fromId: L2.sol, toId: L2.verdan }, 'game:state');
    expect(second.ok).toBe(false);
    if (!second.ok) log.push(`P1 second seal → ${second.error}`);

    // Hand the turn to Helion (P3): P1 attack→fortify→end, P2 draft→attack→fortify→end.
    await endTurn(c1, gameId, 'attack');
    await waitForRedisState(gameId, (s) => s.current_player_index === 1);
    await endTurn(c2, gameId, 'draft');
    await waitForRedisState(gameId, (s) => s.current_player_index === 2 && s.phase === 'draft');
    expect((await act(c3, 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'attack');

    const blocked = await act(c3, 'game:attack', { gameId, fromId: L1.verdan, toId: L1.sol }, 'game:combat_result');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) { expect(blocked.code).toBe('LANE_SEALED'); log.push(`P3 across sealed L1 → ${blocked.error}`); }

    // The sister lane between the same two worlds is untouched.
    const sister = await act<{ result: { territory_captured: boolean } }>(c3, 'game:attack', { gameId, fromId: L2.verdan, toId: L2.sol }, 'game:combat_result');
    expect(sister.ok, sister.ok ? '' : sister.error).toBe(true);
    if (sister.ok) log.push(`P3 across sister lane L2 → captured ${sister.data.result.territory_captured}`);
    console.log('\n[seal]\n' + log.join('\n'));
  }, 90_000);

  it('the sealer crosses their own seal', async () => {
    const gameId = 'itest-ga-own-seal';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.players[0].unlocked_techs = ['ga_hyperspace_chart'];
    state.lane_blockades = { [orbitLaneId(L1.sol, L1.verdan)]: { owner_id: P[0], turns_remaining: 3 } };
    armAssault(state, L1.sol, L1.verdan);
    await seed(gameId, state, map);
    const c = await connect(P[0]); await joinRoom(P[0], gameId);
    const r = await act<{ result: { territory_captured: boolean } }>(c, 'game:attack', { gameId, fromId: L1.sol, toId: L1.verdan }, 'game:combat_result');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  }, 30_000);

  it('a seal lifts when the round wraps (3 rounds from a fresh seal)', async () => {
    const gameId = 'itest-ga-seal-expiry';
    const map = freshMap(); const state = freshState(gameId, map);
    state.phase = 'attack'; state.current_player_index = 0;
    state.lane_blockades = { [orbitLaneId(L1.sol, L1.verdan)]: { owner_id: P[0], turns_remaining: 1 } };
    await seed(gameId, state, map);
    const cs = await Promise.all(P.map(async (id) => { const c = await connect(id); await joinRoom(id, gameId); return c; }));
    const startTurn = state.turn_number;
    await endTurn(cs[0], gameId, 'attack');
    await waitForRedisState(gameId, (s) => s.current_player_index === 1);
    for (let i = 1; i < 4; i++) {
      await endTurn(cs[i], gameId, 'draft');
      await waitForRedisState(gameId, (s) => s.current_player_index === (i + 1) % 4);
    }
    const after = await waitForRedisState(gameId, (s) => s.turn_number === startTurn + 1);
    expect(after.lane_blockades ?? {}).toEqual({});
  }, 90_000);

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
    // Custodians — Emergency Seal (terraform), draft phase, own tile
    {
      const gameId = 'itest-ga-abil-void';
      const map = freshMap(); const state = freshState(gameId, map, { stability_enabled: true } as Partial<GameSettings>);
      state.phase = 'draft'; state.current_player_index = 3; state.draft_units_remaining = 0;
      const own = Object.values(state.territories).find((t) => t.owner_id === P[3])!;
      own.stability = 20; const before = own.unit_count;
      await seed(gameId, state, map);
      const c = await connect(P[3]); await joinRoom(P[3], gameId);
      const r = await act(c, 'game:use_ability', { gameId, abilityId: 'terraform', params: { territoryId: own.territory_id } }, 'game:ability_result');
      const s = await getGameState(gameId);
      log.push(`void terraform → ${r.ok ? 'OK' : 'ERROR ' + r.error}; units ${before} → ${s!.territories[own.territory_id].unit_count}; stability 20 → ${s!.territories[own.territory_id].stability}`);
      expect(r.ok).toBe(true);
    }
    // Mandate — Cyber Strike (cyber_attack) across an orbit lane WITHOUT the chart
    {
      const gameId = 'itest-ga-abil-mandate';
      const map = freshMap(); const state = freshState(gameId, map);
      state.phase = 'attack'; state.current_player_index = 0;
      state.territories[L1.verdan].unit_count = 5;
      await seed(gameId, state, map);
      const c = await connect(P[0]); await joinRoom(P[0], gameId);
      const r = await act(c, 'game:use_ability', { gameId, abilityId: 'cyber_attack', params: { territoryId: L1.verdan } }, 'game:ability_result');
      const s = await getGameState(gameId);
      log.push(`mandate cyber_attack across lane, no chart → ${r.ok ? 'OK' : 'ERROR ' + r.error}; target units 5 → ${s!.territories[L1.verdan].unit_count}`);
      // The strike used to cross a hyperspace lane with no Chart researched.
      expect(r.ok).toBe(false);
      expect(s!.territories[L1.verdan].unit_count).toBe(5);
    }
    console.log('\n[faction abilities]\n' + log.join('\n'));
  }, 120_000);

  // Territory Draft is rejected for galaxy maps at the create boundary
  // (territorySelectionRejection). This case pins the reason: the exo tiles
  // arrive neutral with zero units, which no attack can ever resolve against.
  it('territory selection leaves every off-world tile neutral with no garrison', async () => {
    const gameId = 'itest-ga-select';
    const map = freshMap(); const state = freshState(gameId, map, { territory_selection: true } as Partial<GameSettings>);
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

  it('the Hyperlane Anchor wonder grants lane access with no tech, for 22 production', async () => {
    const gameId = 'itest-ga-anchor';
    const map = freshMap(); const state = freshState(gameId, map);
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
});

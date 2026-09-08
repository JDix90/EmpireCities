/**
 * The Space Age Moon ladder over the real wire, on the real map.
 *
 * This is the era's signature mechanic and it has broken silently before: AI
 * launches were attempted after the phase transition, so bots never reached the
 * Moon at all (0 launches across 120 simulated games) and nothing failed — the
 * executor just returned an error nobody read. Unit tests cover the pure
 * helpers; this covers the orchestration a human actually drives.
 *
 * Complements `gameAttackSocket.test.ts`, which covers the neutral-Moon denial
 * copy on a synthetic board. Here the board is `era_space_age.json` itself, so
 * the authored orbit lanes and the Launch-Pad lane rule are both exercised.
 *
 * Redis-gated like the rest of the Redis tier:
 *   redis-server --port 6390 --daemonize yes
 *   REDIS_TEST=1 REDIS_HOST=localhost REDIS_PORT=6390 \
 *     pnpm exec vitest run src/sockets/spaceAgeMoonLadderSocket.test.ts
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
import { nearestLandingZoneFor } from '../game-engine/state/moonAccess';

const redisTestEnabled = process.env.REDIS_TEST === '1';

/** The Space Program, in the order a player must buy it. */
const LADDER = [
  'sa_digital_warfare',
  'sa_orbital_recon',
  'sa_launch_pad_tech',
  'sa_space_station',
  'sa_lunar_expansion',
] as const;

/** An ordinary Earth tile with no authored orbit lane — the point of the test. */
const INLAND_TILE = 'la_pampas';

/**
 * Distinct user ids. Socket rate limits bucket per user (gameplay: 30 actions
 * per 10s), so reusing the `p1` that gameAttackSocket.test.ts authenticates as
 * made the two files throttle each other when the tier runs in parallel.
 */
const P1 = 'sa_ladder_p1';
const P2 = 'sa_ladder_p2';

describe.runIf(redisTestEnabled)('Space Age Moon ladder — human socket path', () => {
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
  const AUTHORED = JSON.parse(
    readFileSync(join(__dirname, '../../../database/maps/era_space_age.json'), 'utf-8'),
  ) as GameMap;

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
    await redisMod.redis.connect().catch(() => { /* lazyConnect */ });

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
  });

  function freshMap(): GameMap {
    return JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  }

  function settings(): GameSettings {
    return {
      fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
      diplomacy_enabled: false, factions_enabled: false, naval_enabled: false, events_enabled: false,
      economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
      era_advancement_enabled: false, space_age_frontiers_enabled: false,
      allowed_victory_conditions: ['domination', 'threshold'], victory_type: 'domination',
      victory_threshold: 60, max_turns: 90,
    } as unknown as GameSettings;
  }

  function freshState(gameId: string, map: GameMap): GameState {
    const players = [P1, P2].map((id, i) => ({
      player_id: id, player_index: i, username: id.toUpperCase(),
      color: i ? '#3498db' : '#c0392b', is_ai: false, is_eliminated: false, mmr: 1000,
    }));
    const state = initializeGameState(gameId, 'space_age', map, players, settings(), {
      forceStartingPlayerIndex: 0,
    });
    state.map_id = gameId;
    return state;
  }

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

  async function joinRoom(userId: string, gameId: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = [...ioServer.sockets.sockets.values()].find((sk) => sk.data?.userId === userId);
      if (s) { s.join(gameId); return; }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`server socket for ${userId} not found`);
  }

  type ActResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

  /** Emit, then resolve with whichever of `okEvent` or 'error' arrives first. */
  function act<T = unknown>(
    client: ClientSocket, event: string, payload: object, okEvent: string,
  ): Promise<ActResult<T>> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout on ${event}`)), 10_000);
      const onOk = (data: T) => { cleanup(); resolve({ ok: true, data }); };
      const onErr = (e: { message: string; code?: string }) => {
        cleanup(); resolve({ ok: false, error: e.message, code: e.code });
      };
      const cleanup = () => { clearTimeout(t); client.off(okEvent, onOk); client.off('error', onErr); };
      client.on(okEvent, onOk);
      client.on('error', onErr);
      client.emit(event, payload);
    });
  }

  async function waitForRedisState(
    gameId: string, predicate: (s: GameState) => boolean,
  ): Promise<GameState> {
    for (let i = 0; i < 300; i++) {
      const s = await getGameState(gameId);
      if (s && predicate(s)) return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for persisted Redis state');
  }

  it('climbs the whole ladder from an inland tile and lands on the Moon through its own lane', async () => {
    const gameId = 'itest-ladder-inland';
    const map = freshMap();
    const state = freshState(gameId, map);
    // p1 holds ONE ordinary inland tile — no authored orbit lane anywhere near
    // it. Before Launch Pads opened their own lane this player could finish the
    // entire Space Program and still have no edge to cross.
    state.territories[INLAND_TILE].owner_id = P1;
    state.territories[INLAND_TILE].unit_count = 40;
    state.players[0].tech_points = 70;
    state.players[0].special_resource = 20;
    state.draft_units_remaining = 0;
    state.phase = 'draft';
    // The landing zone is thinned and the dice fixed so the crossing resolves in
    // one exchange: this test is about the lane and the gate, and a long attack
    // loop would trip the per-user gameplay rate limit (30 actions / 10s).
    const target = nearestLandingZoneFor(map, INLAND_TILE)!.moonTarget;
    state.territories[target].unit_count = 1;
    state.puzzle_dice_queue = [6, 6, 6, 1];
    await seed(gameId, state, map);

    const client = await connect(P1);
    await joinRoom(P1, gameId);
    const log: string[] = [];

    // The pad is gated on its tech, and the launch on the pad.
    const earlyBuild = await act(client, 'game:build',
      { gameId, territoryId: INLAND_TILE, buildingType: 'launch_pad' }, 'game:build_result');
    expect(earlyBuild.ok).toBe(false);
    log.push(`build before tech → ${earlyBuild.ok ? 'ok' : earlyBuild.error}`);

    for (const techId of LADDER) {
      const r = await act(client, 'game:research_tech', { gameId, techId }, 'game:research_result');
      expect(r.ok, `research ${techId}`).toBe(true);
    }
    await waitForRedisState(gameId, (s) => (s.players[0].unlocked_techs ?? []).includes('sa_lunar_expansion'));

    const launchNoPad = await act(client, 'game:use_ability',
      { gameId, abilityId: 'launch_space_station' }, 'game:ability_result');
    expect(launchNoPad.ok).toBe(false);
    log.push(`launch before pad → ${launchNoPad.ok ? 'ok' : launchNoPad.error}`);

    // Building the pad opens the lane and announces it room-wide.
    const laneOpened = new Promise<{ territoryId: string; moonTargetId: string }>((resolve) => {
      client.once('game:orbit_lane_opened', resolve);
    });
    const build = await act(client, 'game:build',
      { gameId, territoryId: INLAND_TILE, buildingType: 'launch_pad' }, 'game:build_result');
    expect(build.ok).toBe(true);
    const lane = await laneOpened;
    const expectedTarget = target;
    expect(lane.territoryId).toBe(INLAND_TILE);
    expect(lane.moonTargetId).toBe(expectedTarget);
    log.push(`lane opened → ${lane.territoryId} → ${lane.moonTargetId}`);

    const launched = new Promise<{ launchTerritoryId: string }>((resolve) => {
      client.once('game:space_station_launched', resolve);
    });
    const launch = await act(client, 'game:use_ability',
      { gameId, abilityId: 'launch_space_station' }, 'game:ability_result');
    expect(launch.ok).toBe(true);
    expect((await launched).launchTerritoryId).toBe(INLAND_TILE);
    await waitForRedisState(gameId, (s) => s.players[0].space_station_launched === true);

    expect((await act(client, 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'attack');

    // Cross the lane the pad opened and take the landing zone.
    const assault = await act<{ result: { territory_captured: boolean } }>(client, 'game:attack',
      { gameId, fromId: INLAND_TILE, toId: expectedTarget }, 'game:combat_result');
    expect(assault.ok, assault.ok ? '' : `attack rejected: ${assault.error}`).toBe(true);
    if (!assault.ok) return;
    log.push(`captured ${expectedTarget}: ${assault.data.result.territory_captured}`);
    expect(assault.data.result.territory_captured).toBe(true);
    const after = await waitForRedisState(gameId, (s) => s.territories[expectedTarget].owner_id === P1);
    expect(after.territories[expectedTarget].owner_id).toBe(P1);

    console.log('\n[inland ladder]\n' + log.join('\n'));
  }, 90_000);

  it('refuses an orbit crossing before the ladder is finished, and says what is missing', async () => {
    const gameId = 'itest-ladder-gate-copy';
    const map = freshMap();
    const state = freshState(gameId, map);
    state.territories.na_launch_base.owner_id = P1;
    state.territories.na_launch_base.unit_count = 12;
    state.phase = 'attack';
    await seed(gameId, state, map);

    const client = await connect(P1);
    await joinRoom(P1, gameId);
    const r = await act(client, 'game:attack',
      { gameId, fromId: 'na_launch_base', toId: 'moon_near_side_north' }, 'game:combat_result');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ACCESS_DENIED');
      // Names all three missing rungs rather than a bare "not allowed".
      expect(r.error).toBe(
        'Moon access requires: Lunar Expansion tech + Launch Pad building + launched Space Station',
      );
    }
  }, 30_000);

  it('lets a player who lost their last pad keep manoeuvring on the Moon but not cross back', async () => {
    // Losing the pad revokes orbit access, because getMoonAccessState recomputes
    // it live. Fortify used to gate ANY Moon endpoint, which froze movement
    // between a player's own adjacent Moon tiles while attacking and
    // reinforcing them stayed legal — inconsistent enough to read as a bug.
    // Fortify now gates orbit EDGES only, like attacks.
    const gameId = 'itest-ladder-stranded';
    const map = freshMap();
    const state = freshState(gameId, map);
    state.players[0].unlocked_techs = [...LADDER];
    state.players[0].space_station_launched = true;
    // Two adjacent Moon tiles held, joined by an interior land edge.
    const [a, b] = ['moon_near_side_north', 'moon_mare_imbrium'];
    const interiorEdge = map.connections.find(
      (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
    );
    expect(interiorEdge, 'fixture expects an interior lunar edge').toBeDefined();
    expect(interiorEdge!.type).toBe('land');

    state.territories[a].owner_id = P1;
    state.territories[a].unit_count = 12;
    state.territories[b].owner_id = P1;
    state.territories[b].unit_count = 2;
    // The Earth end of the lane belongs to the rival, and p1 owns no pad.
    state.territories.na_launch_base.owner_id = P2;
    state.territories.na_launch_base.unit_count = 3;
    for (const t of Object.values(state.territories)) t.buildings = [];
    state.phase = 'attack';
    await seed(gameId, state, map);

    const client = await connect(P1);
    await joinRoom(P1, gameId);
    const log: string[] = [];

    // Crossing back down to Earth is an orbit edge: still gated, and it names
    // the one rung that is now missing.
    const toEarth = await act(client, 'game:attack',
      { gameId, fromId: a, toId: 'na_launch_base' }, 'game:combat_result');
    log.push(`moon→Earth attack → ${toEarth.ok ? 'ok' : toEarth.error}`);
    expect(toEarth.ok).toBe(false);
    if (!toEarth.ok) expect(toEarth.error).toBe('Moon access requires: Launch Pad building');

    expect((await act(client, 'game:advance_phase', { gameId }, 'game:state')).ok).toBe(true);
    await waitForRedisState(gameId, (s) => s.phase === 'fortify');

    // Interior lunar movement is theirs to make.
    const fortify = await act(client, 'game:fortify',
      { gameId, fromId: a, toId: b, units: 3 }, 'game:fortify_result');
    log.push(`fortify own moon→own moon → ${fortify.ok ? 'ok' : fortify.error}`);
    expect(fortify.ok).toBe(true);
    const moved = await waitForRedisState(gameId, (s) => s.territories[b].unit_count > 2);
    expect(moved.territories[b].unit_count).toBe(5);
    expect(moved.territories[a].unit_count).toBe(9);

    console.log('\n[stranded on the Moon]\n' + log.join('\n'));
  }, 45_000);
});

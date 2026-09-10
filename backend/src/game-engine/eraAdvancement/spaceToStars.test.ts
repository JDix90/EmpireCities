/**
 * Space to Stars — the two-step climb from the Space Age to the Galactic Age on
 * one board (`era_ascension_galaxy`).
 *
 * The cases that matter, each one a bug the sim found before the code did:
 *   • the board is Earth + Moon at start and the three far worlds are NOT on it;
 *   • leaving the Space Age needs the Space Program, not a tech count — without
 *     that gate every seat climbed by turn 15, `executeAdvanceEra` wiped their
 *     Lunar Expansion on the way, and across 10 games nobody ever reached the
 *     Moon, let alone the worlds past it;
 *   • arriving flips the player's own orbit regime to hyperspace, so the tech
 *     wipe stops mattering and lanes become positional;
 *   • the far worlds arrive as neutral frontiers that defend, gateways softest;
 *   • the Pathfinder Gate seals the lanes to worlds you have not reached — and
 *     only those.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from '../state/gameStateManager';
import { canAdvanceEra, executeAdvanceEra } from './advanceEra';
import { getStateSpineSteps } from './spines';
import { unlockTerritoriesForFloor, frontierGarrisonSizer } from './territoryUnlock';
import { grantEraSignature, PATHFINDER_GATE_ROUNDS } from './signatures';
import { resolvePlayerEraId } from './constants';
import { orbitLaneId, resolveOrbitAccessModeForPlayer } from '../state/moonAccess';

const MAP = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ascension_galaxy.json'), 'utf-8'),
) as GameMap;

const EXO = new Set(['verdan', 'rust', 'nexus_station']);

function freshMap(): GameMap {
  return JSON.parse(JSON.stringify(MAP)) as GameMap;
}

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: false, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: true, era_advancement_spine_id: 'space_to_stars',
    galaxy_corridors_enabled: true, world_rules_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function newGame(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = freshMap();
  const players = [0, 1, 2, 3].map((i) => ({
    player_id: `p${i}`, player_index: i, username: `P${i}`, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000,
  }));
  return {
    state: initializeGameState('t_sts', 'space_age', map, players as never, settings(overrides), {
      forceStartingPlayerIndex: 0,
    }),
    map,
  };
}

/**
 * Give p0 everything the milestone gate asks for (tier-1 x3, tier-2 x2,
 * tier-3 x1, three buildings) so the ONLY thing that can still refuse the
 * advance is the Space Program — which `moonAccess` decides.
 */
function readyToAdvance(state: GameState, opts: { moonAccess: boolean }): void {
  const p = state.players[0];
  p.special_resource = 9999;
  p.unlocked_techs = [
    'sa_digital_warfare', 'sa_orbital_recon', 'sa_megacity', // tier 1
    'sa_launch_pad_tech', 'sa_ai_command', // tier 2
    'sa_space_station', // tier 3
  ];
  const mine = Object.values(state.territories).filter((t) => t.owner_id === p.player_id);
  expect(mine.length).toBeGreaterThanOrEqual(3);
  mine[0].buildings = ['factory'];
  mine[1].buildings = ['bunker'];
  mine[2].buildings = ['barracks'];
  if (opts.moonAccess) {
    p.unlocked_techs.push('sa_lunar_expansion');
    p.space_station_launched = true;
    mine[0].buildings = [...mine[0].buildings!, 'launch_pad'];
  }
}

describe('the board', () => {
  it('starts as Earth and the Moon, with the far worlds off it', () => {
    const { state } = newGame();
    const worlds = new Set(Object.values(state.territories).map((t) => t.world_id));
    expect(worlds).toEqual(new Set(['earth', 'moon']));
    // The far worlds exist in the map file — they are simply not in play yet.
    expect(MAP.territories.filter((t) => EXO.has(t.world_id ?? '')).length).toBe(48);
    expect(MAP.worlds?.map((w) => w.world_id)).toEqual(['earth', 'moon', 'verdan', 'rust', 'nexus_station']);
  });

  it('puts the 2100 frontiers in play from turn one', () => {
    // This board's ONE growth step belongs to the stars, so a frontier tagged
    // for a step that does not exist here would never appear at all.
    const earthTagged = MAP.territories.filter(
      (t) => !EXO.has(t.world_id ?? '') && (t.unlock_era_index ?? 0) > 0,
    );
    expect(earthTagged).toEqual([]);
  });

  it('runs the ring through the Moon — every far world is one lane from it', () => {
    const worldOf = new Map(MAP.territories.map((t) => [t.territory_id, t.world_id]));
    const reachable = new Set<string>();
    for (const c of MAP.connections) {
      if (c.type !== 'orbit') continue;
      const a = worldOf.get(c.from);
      const b = worldOf.get(c.to);
      if (a === 'moon' && b) reachable.add(b);
      if (b === 'moon' && a) reachable.add(a);
    }
    expect(reachable.has('verdan')).toBe(true);
    expect(reachable.has('nexus_station')).toBe(true);
  });
});

describe('leaving the Space Age', () => {
  it('is refused without the Space Program, however much tech you have', () => {
    const { state } = newGame();
    expect(getStateSpineSteps(state)[0].gate_requires_moon_access).toBe(true);
    readyToAdvance(state, { moonAccess: false });
    const gate = canAdvanceEra(state, 'p0');
    expect(gate.canAdvance).toBe(false);
    expect(gate.error).toMatch(/Space Program/);
  });

  it('is allowed once the ladder is finished', () => {
    const { state } = newGame();
    readyToAdvance(state, { moonAccess: true });
    expect(canAdvanceEra(state, 'p0').canAdvance).toBe(true);
  });
});

describe('arriving in the Galactic Age', () => {
  it('flips that player to hyperspace access while everyone else stays on the ladder', () => {
    const { state, map } = newGame();
    readyToAdvance(state, { moonAccess: true });
    expect(resolveOrbitAccessModeForPlayer(state, state.players[0], map, state.era)).toBe('space_age_moon');

    expect(executeAdvanceEra(state, 'p0', map).success).toBe(true);
    expect(resolvePlayerEraId(state, state.players[0])).toBe('galaxy_age');
    // The advance cleared unlocked_techs — including Lunar Expansion. Under the
    // board's era alone that would strand them off-world forever.
    expect(state.players[0].unlocked_techs).toEqual([]);
    expect(resolveOrbitAccessModeForPlayer(state, state.players[0], map, state.era)).toBe('galaxy_hyperspace');
    expect(resolveOrbitAccessModeForPlayer(state, state.players[1], map, state.era)).toBe('space_age_moon');
  });

  it('opens the three far worlds for everybody, as neutral frontiers', () => {
    const { state, map } = newGame();
    readyToAdvance(state, { moonAccess: true });
    executeAdvanceEra(state, 'p0', map);

    const added = unlockTerritoriesForFloor(state, map);
    expect(added.length).toBe(48);
    for (const tid of added) {
      expect(state.territories[tid].owner_id).toBeNull();
      expect(state.territories[tid].unit_count).toBeGreaterThanOrEqual(3);
    }
    // Idempotent: a second call on the same floor adds nothing.
    expect(unlockTerritoriesForFloor(state, map)).toEqual([]);
  });

  it('defends the far worlds unevenly — the gateways are the way in', () => {
    const map = freshMap();
    const sizer = frontierGarrisonSizer(map);
    const gatewayIds = new Set<string>();
    for (const c of map.connections) {
      if (c.type === 'orbit') { gatewayIds.add(c.from); gatewayIds.add(c.to); }
    }
    const exoTiles = map.territories.filter((t) => EXO.has(t.world_id ?? ''));
    const gateway = exoTiles.find((t) => gatewayIds.has(t.territory_id))!;
    const interior = exoTiles.find(
      (t) => !gatewayIds.has(t.territory_id) && t.region_id !== 'nexus_gate_ring',
    )!;
    expect(sizer(gateway)).toBe(3);
    expect(sizer(interior)).toBe(4);
    // The Nexus Vault keeps its authored garrison wherever it arrives from.
    const vaultTile = map.territories.find((t) => t.region_id === 'nexus_gate_ring')!;
    expect(sizer(vaultTile)).toBe(6);
  });
});

describe('the Pathfinder Gate', () => {
  it('seals the lanes to worlds you have not reached, and nothing behind you', () => {
    const { state, map } = newGame();
    // p0 holds one end of every Moon lane and one Earth end too.
    const moonLaneEnds = map.connections
      .filter((c) => c.type === 'orbit')
      .flatMap((c) => [c.from, c.to])
      .filter((tid) => state.territories[tid]?.world_id === 'moon');
    expect(moonLaneEnds.length).toBeGreaterThan(0);
    for (const tid of moonLaneEnds) state.territories[tid].owner_id = 'p0';

    grantEraSignature(state, state.players[0], 'pathfinder_gate', map);
    const sealed = state.lane_blockades ?? {};
    expect(Object.keys(sealed).length).toBeGreaterThan(0);
    for (const b of Object.values(sealed)) {
      expect(b).toEqual({ owner_id: 'p0', turns_remaining: PATHFINDER_GATE_ROUNDS });
    }
    // Every sealed lane leads AWAY from a world p0 stands on.
    const worldOf = new Map(map.territories.map((t) => [t.territory_id, t.world_id]));
    const reached = new Set(
      Object.values(state.territories).filter((t) => t.owner_id === 'p0').map((t) => t.world_id),
    );
    for (const id of Object.keys(sealed)) {
      const [a, b] = id.split('::');
      const far = state.territories[a]?.owner_id === 'p0' ? b : a;
      expect(reached.has(worldOf.get(far))).toBe(false);
    }
    // …so an Earth↔Moon lane whose Moon end is p0's is NOT sealed: they are
    // already on the Moon, and a seal there would wall off a war in progress.
    const earthMoon = map.connections.find(
      (c) => c.type === 'orbit'
        && [c.from, c.to].some((t) => worldOf.get(t) === 'earth')
        && [c.from, c.to].some((t) => worldOf.get(t) === 'moon'),
    )!;
    expect(sealed[orbitLaneId(earthMoon.from, earthMoon.to)]).toBeUndefined();
  });

  it('no-ops without a map — the other signatures stay map-free', () => {
    const { state } = newGame();
    grantEraSignature(state, state.players[0], 'pathfinder_gate');
    expect(state.lane_blockades).toBeUndefined();
  });
});

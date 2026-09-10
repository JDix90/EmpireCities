import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  resolveOrbitAccessMode,
  getOrbitAccessResult,
  formatOrbitAccessError,
  fortifyEndpointsRequireOrbitAccess,
  fortifyTraversalFilter,
  territoryRequiresOrbitAccessForClaim,
  offworldTerritoryIdsForInitialNeutral,
  selectionExemptTerritoryIds,
} from './moonAccess';

describe('orbit access (galaxy_age)', () => {
  const galaxyMap: GameMap = {
    map_id: 'test_galaxy',
    name: 'Test',
    territories: [
      {
        territory_id: 'sol_a',
        name: 'Sol A',
        polygon: [],
        center_point: [0, 0],
        region_id: 'core',
        world_id: 'sol',
      },
      {
        territory_id: 'out_a',
        name: 'Out A',
        polygon: [],
        center_point: [0, 0],
        region_id: 'rim',
        world_id: 'verdan',
      },
    ],
    connections: [
      { from: 'sol_a', to: 'out_a', type: 'orbit' },
    ],
    regions: [
      { region_id: 'core', name: 'Core', bonus: 2 },
      { region_id: 'rim', name: 'Rim', bonus: 2 },
    ],
    worlds: [
      { world_id: 'sol', display_name: 'Sol', requires_orbit_access: false },
      { world_id: 'verdan', display_name: 'Verdan', requires_orbit_access: true },
    ],
  };

  it('defaults orbit mode from era', () => {
    expect(resolveOrbitAccessMode(galaxyMap, 'galaxy_age')).toBe('galaxy_hyperspace');
    expect(resolveOrbitAccessMode(galaxyMap, 'space_age')).toBe('space_age_moon');
  });

  it('flags manifest offworld for claims', () => {
    expect(territoryRequiresOrbitAccessForClaim(galaxyMap, 'out_a')).toBe(true);
    expect(territoryRequiresOrbitAccessForClaim(galaxyMap, 'sol_a')).toBe(false);
  });

  it('does NOT seed orbit-locked worlds as neutral by default (galaxy era spawns factions on their lore home)', () => {
    expect(offworldTerritoryIdsForInitialNeutral(galaxyMap).size).toBe(0);
  });

  it('seeds neutral garrisons only when initial_neutral_garrison is set', () => {
    const neutralMap: GameMap = {
      ...galaxyMap,
      worlds: [
        { world_id: 'sol', display_name: 'Sol', requires_orbit_access: false },
        {
          world_id: 'verdan',
          display_name: 'Verdan',
          requires_orbit_access: true,
          initial_neutral_garrison: true,
        },
      ],
    };
    const neutral = offworldTerritoryIdsForInitialNeutral(neutralMap);
    expect(neutral.has('out_a')).toBe(true);
    expect(neutral.has('sol_a')).toBe(false);
  });

  it('legacy moon fallback still seeds Space Age moon territories as neutral when worlds[] is omitted', () => {
    const spaceAgeMap: GameMap = {
      map_id: 'test_space',
      name: 'Space',
      territories: [
        {
          territory_id: 'usa_1',
          name: 'USA',
          polygon: [],
          center_point: [0, 0],
          region_id: 'na',
        },
        {
          territory_id: 'moon_1',
          name: 'Moon',
          polygon: [],
          center_point: [0, 0],
          region_id: 'lunar_surface',
          globe_id: 'moon',
        },
      ],
      connections: [],
      regions: [
        { region_id: 'na', name: 'NA', bonus: 2 },
        { region_id: 'lunar_surface', name: 'Moon', bonus: 2 },
      ],
    };
    const neutral = offworldTerritoryIdsForInitialNeutral(spaceAgeMap);
    expect(neutral.has('moon_1')).toBe(true);
    expect(neutral.has('usa_1')).toBe(false);
  });

  it('requires ga_hyperspace_chart unless faction or wonder', () => {
    const state = { era: 'galaxy_age' } as GameState;
    const plain = {
      unlocked_techs: [],
      faction_id: 'stellar_mandate',
      player_id: 'p1',
    } as unknown as PlayerState;
    expect(getOrbitAccessResult(state, plain, galaxyMap, 'galaxy_age').allowed).toBe(false);

    const helion = { ...plain, faction_id: 'helion_navigators' };
    expect(getOrbitAccessResult(state, helion, galaxyMap, 'galaxy_age').allowed).toBe(true);

    const teched = { ...plain, faction_id: 'stellar_mandate', unlocked_techs: ['ga_hyperspace_chart'] };
    expect(getOrbitAccessResult(state, teched, galaxyMap, 'galaxy_age').allowed).toBe(true);
  });

  it('does not gate interior fortify on the same offworld for galaxy era', () => {
    const twin: GameMap = {
      map_id: 'twin',
      name: 'Twin',
      territories: [
        {
          territory_id: 'x',
          name: 'X',
          polygon: [],
          center_point: [0, 0],
          region_id: 'r',
          world_id: 'verdan',
        },
        {
          territory_id: 'y',
          name: 'Y',
          polygon: [],
          center_point: [0, 0],
          region_id: 'r',
          world_id: 'verdan',
        },
      ],
      connections: [{ from: 'x', to: 'y', type: 'land' }],
      regions: [{ region_id: 'r', name: 'R', bonus: 2 }],
      worlds: [{ world_id: 'verdan', display_name: 'V', requires_orbit_access: true }],
    };
    expect(fortifyEndpointsRequireOrbitAccess(twin, 'galaxy_age', 'x', 'y')).toBe(false);
  });
});

describe('space age fortify gating', () => {
  const map: GameMap = {
    map_id: 'era_space_age_mini',
    name: 'Mini Space Age',
    territories: [
      { territory_id: 'na_launch_base', name: 'Cape', polygon: [], center_point: [0, 0], region_id: 'na' },
      { territory_id: 'na_east', name: 'East', polygon: [], center_point: [0, 0], region_id: 'na' },
      { territory_id: 'moon_a', name: 'Moon A', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
      { territory_id: 'moon_b', name: 'Moon B', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
    ],
    connections: [
      { from: 'na_launch_base', to: 'na_east', type: 'land' },
      { from: 'na_launch_base', to: 'moon_a', type: 'orbit' },
      { from: 'moon_a', to: 'moon_b', type: 'land' },
    ],
    regions: [
      { region_id: 'na', name: 'North America', bonus: 3 },
      { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 6 },
    ],
  } as GameMap;

  it('gates crossing an orbit lane in both directions', () => {
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'na_launch_base', 'moon_a')).toBe(true);
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'moon_a', 'na_launch_base')).toBe(true);
  });

  it('leaves a move between two Moon tiles ungated', () => {
    // A player who lost their last Launch Pad keeps their Moon holdings and can
    // still shuffle troops between them; only crossing back to Earth is blocked.
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'moon_a', 'moon_b')).toBe(false);
  });

  it('leaves an ordinary Earth move ungated', () => {
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'na_launch_base', 'na_east')).toBe(false);
  });

  it('gates endpoints on different worlds even when neither sits on a lane', () => {
    // Regression: gating only the direct from→to edge let a player holding
    // na_east → na_launch_base → moon_a → moon_b fortify straight to the Moon
    // with the orbit gate shut, because na_east→moon_b is not itself a lane.
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'na_east', 'moon_b')).toBe(true);
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'moon_b', 'na_east')).toBe(true);
  });

  it('does not gate a move whose endpoint is not on the map', () => {
    expect(fortifyEndpointsRequireOrbitAccess(map, 'space_age', 'na_east', 'nowhere')).toBe(false);
  });
});

describe('fortifyTraversalFilter', () => {
  const map: GameMap = {
    map_id: 'era_space_age_mini',
    name: 'Mini Space Age',
    territories: [
      { territory_id: 'na_launch_base', name: 'Cape', polygon: [], center_point: [0, 0], region_id: 'na' },
      { territory_id: 'na_east', name: 'East', polygon: [], center_point: [0, 0], region_id: 'na' },
      { territory_id: 'moon_a', name: 'Moon A', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
      { territory_id: 'moon_b', name: 'Moon B', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
    ],
    connections: [
      { from: 'na_launch_base', to: 'na_east', type: 'land' },
      { from: 'na_launch_base', to: 'moon_a', type: 'orbit' },
      { from: 'moon_a', to: 'moon_b', type: 'land' },
    ],
    regions: [
      { region_id: 'na', name: 'North America', bonus: 3 },
      { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 6 },
    ],
  } as GameMap;

  const lane = map.connections[1];
  const land = map.connections[0];
  const moonLand = map.connections[2];

  function mkState(over: Partial<GameState> = {}): GameState {
    return {
      era: 'space_age',
      settings: {},
      territories: {
        na_launch_base: { territory_id: 'na_launch_base', owner_id: 'p1', unit_count: 5, buildings: ['launch_pad'] },
        na_east: { territory_id: 'na_east', owner_id: 'p1', unit_count: 5, buildings: [] },
        moon_a: { territory_id: 'moon_a', owner_id: 'p1', unit_count: 5, buildings: [] },
        moon_b: { territory_id: 'moon_b', owner_id: 'p1', unit_count: 5, buildings: [] },
      },
      ...over,
    } as unknown as GameState;
  }

  const gated = { player_id: 'p1', unlocked_techs: [] } as unknown as PlayerState;
  const cleared = {
    player_id: 'p1',
    unlocked_techs: ['sa_lunar_expansion'],
    space_station_launched: true,
  } as unknown as PlayerState;

  it('refuses orbit lanes to a player without access', () => {
    const canTraverse = fortifyTraversalFilter(mkState(), gated, map, 'space_age');
    expect(canTraverse(lane)).toBe(false);
  });

  it('never refuses a land connection, on either world', () => {
    // Interior movement stays free even with the gate shut — that was the whole
    // point of narrowing the rule away from "any Moon endpoint".
    const canTraverse = fortifyTraversalFilter(mkState(), gated, map, 'space_age');
    expect(canTraverse(land)).toBe(true);
    expect(canTraverse(moonLand)).toBe(true);
  });

  it('allows the lane once the ladder is finished', () => {
    const canTraverse = fortifyTraversalFilter(mkState(), cleared, map, 'space_age');
    expect(canTraverse(lane)).toBe(true);
  });

  it('refuses a lane sealed against the player, and allows it for the sealer', () => {
    // Both players have finished the ladder and hold a pad, so the seal is the
    // only thing that can separate their two results.
    const sealed = mkState({
      settings: {},
      lane_blockades: { 'moon_a::na_launch_base': { owner_id: 'p2', turns_remaining: 2 } },
      territories: {
        na_launch_base: { territory_id: 'na_launch_base', owner_id: 'p1', unit_count: 5, buildings: ['launch_pad'] },
        na_east: { territory_id: 'na_east', owner_id: 'p2', unit_count: 5, buildings: ['launch_pad'] },
        moon_a: { territory_id: 'moon_a', owner_id: 'p1', unit_count: 5, buildings: [] },
        moon_b: { territory_id: 'moon_b', owner_id: 'p2', unit_count: 5, buildings: [] },
      },
    } as unknown as Partial<GameState>);
    const sealer = { ...cleared, player_id: 'p2' } as PlayerState;
    expect(getOrbitAccessResult(sealed, cleared, map, 'space_age').allowed).toBe(true);
    expect(getOrbitAccessResult(sealed, sealer, map, 'space_age').allowed).toBe(true);

    expect(fortifyTraversalFilter(sealed, cleared, map, 'space_age')(lane)).toBe(false);
    expect(fortifyTraversalFilter(sealed, sealer, map, 'space_age')(lane)).toBe(true);
  });

  it('lets everything through when the map has no orbit gate at all', () => {
    const canTraverse = fortifyTraversalFilter(mkState({ era: 'modern' } as Partial<GameState>), gated, map, 'modern');
    expect(canTraverse(lane)).toBe(true);
  });
});

describe('formatOrbitAccessError copy', () => {
  const spaceAgeMap: GameMap = {
    map_id: 'era_space_age_mini',
    name: 'Mini Space Age',
    territories: [
      { territory_id: 'earth_1', name: 'Earth 1', polygon: [], center_point: [0, 0], region_id: 'na' },
      { territory_id: 'moon_1', name: 'Moon 1', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
    ],
    connections: [{ from: 'earth_1', to: 'moon_1', type: 'orbit' }],
    regions: [
      { region_id: 'na', name: 'NA', bonus: 2 },
      { region_id: 'lunar_surface', name: 'Moon', bonus: 2 },
    ],
  };

  it('words the Space Age moon ladder as "Moon access requires", matching the client hint', () => {
    const state = { era: 'space_age', territories: {} } as unknown as GameState;
    const player = { player_id: 'p1', unlocked_techs: [] } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, player, spaceAgeMap, 'space_age');
    expect(access.allowed).toBe(false);
    expect(access.mode).toBe('space_age_moon');
    expect(formatOrbitAccessError(access)).toBe(
      'Moon access requires: Lunar Expansion tech + Launch Pad building + launched Space Station',
    );
  });

  it('lists only the missing gates once part of the ladder is done', () => {
    const state = {
      era: 'space_age',
      territories: {
        earth_1: { territory_id: 'earth_1', owner_id: 'p1', unit_count: 3, buildings: ['launch_pad'] },
      },
    } as unknown as GameState;
    const player = { player_id: 'p1', unlocked_techs: ['sa_lunar_expansion'] } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, player, spaceAgeMap, 'space_age');
    expect(formatOrbitAccessError(access)).toBe('Moon access requires: launched Space Station');
  });

  it('needs no tech under corridors: access is positional', () => {
    const galaxyMap: GameMap = {
      ...spaceAgeMap,
      map_id: 'mini_galaxy',
      worlds: [
        { world_id: 'sol', display_name: 'Sol', requires_orbit_access: false },
        { world_id: 'verdan', display_name: 'Verdan', requires_orbit_access: true },
      ],
    };
    const state = {
      era: 'galaxy_age', territories: {}, settings: { galaxy_corridors_enabled: true },
    } as unknown as GameState;
    const player = { player_id: 'p1', faction_id: 'stellar_mandate', unlocked_techs: [] } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, player, galaxyMap, 'galaxy_age');
    expect(access.allowed).toBe(true);
    expect(access.mode).toBe('galaxy_hyperspace');
  });

  it('keeps the hyperspace wording for the galaxy gate when corridors are off', () => {
    const galaxyMap: GameMap = {
      ...spaceAgeMap,
      map_id: 'mini_galaxy',
      worlds: [
        { world_id: 'sol', display_name: 'Sol', requires_orbit_access: false },
        { world_id: 'verdan', display_name: 'Verdan', requires_orbit_access: true },
      ],
    };
    const state = { era: 'galaxy_age', territories: {} } as unknown as GameState;
    const player = { player_id: 'p1', faction_id: 'stellar_mandate', unlocked_techs: [] } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, player, galaxyMap, 'galaxy_age');
    expect(access.mode).toBe('galaxy_hyperspace');
    expect(formatOrbitAccessError(access)).toBe('Hyperspace travel requires: Lane Charts tech');
  });

  it('returns empty copy when access is allowed', () => {
    const state = { era: 'space_age', territories: {} } as unknown as GameState;
    const pioneer = { player_id: 'p1', faction_id: 'lunar_pioneers' } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, pioneer, spaceAgeMap, 'space_age');
    expect(access.allowed).toBe(true);
    expect(formatOrbitAccessError(access)).toBe('');
  });
});

describe('selectionExemptTerritoryIds', () => {
  it('exempts orbit-gated Moon tiles AND seeded frontiers, never plain Earth tiles', () => {
    const map: GameMap = {
      map_id: 'sel_exempt',
      name: 'Selection Exempt',
      territories: [
        { territory_id: 'earth_1', name: 'Earth 1', polygon: [], center_point: [0, 0], region_id: 'na' },
        { territory_id: 'moon_1', name: 'Moon 1', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
        { territory_id: 'frontier_1', name: 'Frontier 1', polygon: [], center_point: [0, 0], region_id: 'na', unlock_era_index: 2 },
      ],
      connections: [{ from: 'earth_1', to: 'moon_1', type: 'orbit' }],
      regions: [{ region_id: 'na', name: 'NA', bonus: 2 }, { region_id: 'lunar_surface', name: 'Moon', bonus: 2 }],
    };
    const exempt = selectionExemptTerritoryIds(map);
    expect(exempt.has('moon_1')).toBe(true); // orbit-gated: unclaimable at start
    expect(exempt.has('frontier_1')).toBe(true); // seeded frontier: conquered, not drafted
    expect(exempt.has('earth_1')).toBe(false); // ordinary tile: still drafted
  });
});

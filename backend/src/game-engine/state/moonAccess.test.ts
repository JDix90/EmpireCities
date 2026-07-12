import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  resolveOrbitAccessMode,
  getOrbitAccessResult,
  formatOrbitAccessError,
  fortifyEndpointsRequireOrbitAccess,
  territoryRequiresOrbitAccessForClaim,
  offworldTerritoryIdsForInitialNeutral,
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

  it('keeps the hyperspace wording for the galaxy gate', () => {
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
    expect(formatOrbitAccessError(access)).toBe('Hyperspace travel requires: Hyperspace Chart tech');
  });

  it('returns empty copy when access is allowed', () => {
    const state = { era: 'space_age', territories: {} } as unknown as GameState;
    const pioneer = { player_id: 'p1', faction_id: 'lunar_pioneers' } as unknown as PlayerState;
    const access = getOrbitAccessResult(state, pioneer, spaceAgeMap, 'space_age');
    expect(access.allowed).toBe(true);
    expect(formatOrbitAccessError(access)).toBe('');
  });
});

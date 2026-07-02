import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  unlockGarrisonForEra,
  globalEraFloor,
  lockedTerritoryIds,
  mapHasEraGrowth,
  projectMapToEraFloor,
  territoryUnlockEra,
  unlockTerritoriesForFloor,
  repairEraTerritoryGrowth,
} from './territoryUnlock';

function mapTerritory(id: string, unlock?: number) {
  return {
    territory_id: id,
    name: id,
    polygon: [[0, 0], [1, 0], [1, 1]],
    center_point: [0, 0] as [number, number],
    region_id: 'r1',
    ...(unlock !== undefined ? { unlock_era_index: unlock } : {}),
  };
}

function makeMap(): GameMap {
  return {
    map_id: 'growth_map',
    name: 'Growth',
    territories: [
      mapTerritory('base_a'),
      mapTerritory('base_b', 0),
      mapTerritory('med_a', 1),
      mapTerritory('disc_a', 2),
      mapTerritory('disc_b', 2),
    ],
    connections: [
      { from: 'base_a', to: 'base_b', type: 'land' },
      { from: 'base_b', to: 'med_a', type: 'land' },
      { from: 'med_a', to: 'disc_a', type: 'land' },
      { from: 'disc_a', to: 'disc_b', type: 'land' },
    ],
    regions: [{ region_id: 'r1', name: 'R1', bonus: 2 }],
  } as GameMap;
}

function makePlayer(id: string, eraIndex: number, eliminated = false): PlayerState {
  return {
    player_id: id,
    player_index: 0,
    username: id,
    color: '#000',
    is_ai: false,
    is_eliminated: eliminated,
    territory_count: 0,
    cards: [],
    current_era_index: eraIndex,
  } as PlayerState;
}

function makeState(players: PlayerState[], floor = 0): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'growth_map',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 1,
    players,
    territories: {
      base_a: { territory_id: 'base_a', owner_id: 'p1', unit_count: 5, unit_type: 'infantry', region_id: 'r1' },
      base_b: { territory_id: 'base_b', owner_id: 'p2', unit_count: 3, unit_type: 'infantry', region_id: 'r1' },
    },
    map_era_floor: floor,
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {},
  } as unknown as GameState;
}

describe('territoryUnlock helpers', () => {
  it('territoryUnlockEra defaults to 0 and clamps negatives', () => {
    expect(territoryUnlockEra({})).toBe(0);
    expect(territoryUnlockEra({ unlock_era_index: 0 })).toBe(0);
    expect(territoryUnlockEra({ unlock_era_index: 2 })).toBe(2);
    expect(territoryUnlockEra({ unlock_era_index: -3 })).toBe(0);
  });

  it('mapHasEraGrowth detects tagged maps and ignores plain ones', () => {
    expect(mapHasEraGrowth(makeMap())).toBe(true);
    const plain = { ...makeMap(), territories: [mapTerritory('a'), mapTerritory('b')] } as GameMap;
    expect(mapHasEraGrowth(plain)).toBe(false);
  });

  it('lockedTerritoryIds returns only territories above the floor', () => {
    const map = makeMap();
    expect([...lockedTerritoryIds(map, 0)].sort()).toEqual(['disc_a', 'disc_b', 'med_a']);
    expect([...lockedTerritoryIds(map, 1)].sort()).toEqual(['disc_a', 'disc_b']);
    expect([...lockedTerritoryIds(map, 2)]).toEqual([]);
  });

  it('globalEraFloor takes the max over living players', () => {
    expect(globalEraFloor(makeState([makePlayer('p1', 0), makePlayer('p2', 1)]))).toBe(1);
    // Eliminated leader does not count.
    expect(globalEraFloor(makeState([makePlayer('p1', 0), makePlayer('p2', 3, true)]))).toBe(0);
  });
});

describe('projectMapToEraFloor', () => {
  it('hides locked territories and any connection touching them', () => {
    const map = makeMap();
    const floor0 = projectMapToEraFloor(map, 0);
    expect(floor0.territories.map((t) => t.territory_id).sort()).toEqual(['base_a', 'base_b']);
    expect(floor0.connections).toEqual([{ from: 'base_a', to: 'base_b', type: 'land' }]);

    const floor1 = projectMapToEraFloor(map, 1);
    expect(floor1.territories.map((t) => t.territory_id).sort()).toEqual(['base_a', 'base_b', 'med_a']);
    // base_b↔med_a now in; med_a↔disc_a still withheld (disc_a locked).
    expect(floor1.connections).toEqual([
      { from: 'base_a', to: 'base_b', type: 'land' },
      { from: 'base_b', to: 'med_a', type: 'land' },
    ]);
  });

  it('is a structural no-op for maps without growth tags', () => {
    const plain = { ...makeMap(), territories: [mapTerritory('a'), mapTerritory('b')], connections: [] } as GameMap;
    expect(projectMapToEraFloor(plain, 0)).toBe(plain);
  });
});

describe('unlockTerritoriesForFloor', () => {
  it('adds the era-1 frontier as a neutral garrison when the first player reaches it', () => {
    const map = makeMap();
    const state = makeState([makePlayer('p1', 1), makePlayer('p2', 0)], 0);
    const added = unlockTerritoriesForFloor(state, map);
    expect(added).toEqual(['med_a']);
    expect(state.map_era_floor).toBe(1);
    const med = state.territories.med_a;
    expect(med).toBeDefined();
    expect(med.owner_id).toBeNull();
    expect(med.unit_count).toBe(unlockGarrisonForEra(1));
    expect(med.region_id).toBe('r1');
    // Era-2 territories remain locked.
    expect(state.territories.disc_a).toBeUndefined();
  });

  it('unlocks the whole (prev, new] window when a player jumps the floor', () => {
    const map = makeMap();
    const state = makeState([makePlayer('p1', 2), makePlayer('p2', 0)], 0);
    const added = unlockTerritoriesForFloor(state, map).sort();
    expect(added).toEqual(['disc_a', 'disc_b', 'med_a']);
    expect(state.map_era_floor).toBe(2);
    // Garrison scales with the unlock era: era-2 frontiers defend harder than era-1.
    expect(state.territories.med_a.unit_count).toBe(unlockGarrisonForEra(1));
    expect(state.territories.disc_a.unit_count).toBe(unlockGarrisonForEra(2));
    expect(unlockGarrisonForEra(2)).toBeGreaterThan(unlockGarrisonForEra(1));
  });

  it('garrison scales with era and is capped', () => {
    expect(unlockGarrisonForEra(1)).toBe(3);
    expect(unlockGarrisonForEra(2)).toBe(4);
    expect(unlockGarrisonForEra(5)).toBe(7);
    expect(unlockGarrisonForEra(99)).toBe(8); // capped
  });

  it('is idempotent — re-running adds nothing and never duplicates', () => {
    const map = makeMap();
    const state = makeState([makePlayer('p1', 1), makePlayer('p2', 0)], 0);
    unlockTerritoriesForFloor(state, map);
    const again = unlockTerritoriesForFloor(state, map);
    expect(again).toEqual([]);
    expect(state.map_era_floor).toBe(1);
    expect(Object.keys(state.territories).filter((k) => k === 'med_a')).toHaveLength(1);
  });

  it('does nothing on a map without growth tags', () => {
    const plain = { ...makeMap(), territories: [mapTerritory('a'), mapTerritory('b')] } as GameMap;
    const state = makeState([makePlayer('p1', 3)], 0);
    const added = unlockTerritoriesForFloor(state, plain);
    expect(added).toEqual([]);
  });

  it('never overwrites a territory already conquered before a later re-check', () => {
    const map = makeMap();
    const state = makeState([makePlayer('p1', 1)], 0);
    unlockTerritoriesForFloor(state, map);
    // A player conquers the frontier.
    state.territories.med_a.owner_id = 'p1';
    state.territories.med_a.unit_count = 9;
    // Floor unchanged; re-check must not reset ownership/units.
    unlockTerritoriesForFloor(state, map);
    expect(state.territories.med_a.owner_id).toBe('p1');
    expect(state.territories.med_a.unit_count).toBe(9);
  });
});

describe('repairEraTerritoryGrowth (migration backfill)', () => {
  it('backfills frontiers up to the current floor for a legacy era-advancement game', () => {
    const map = makeMap();
    // Legacy game: only base territories in play, no map_era_floor, player already at era 2.
    const state = makeState([makePlayer('p1', 2)], 0);
    state.settings = { era_advancement_enabled: true } as GameState['settings'];
    delete (state as { map_era_floor?: number }).map_era_floor;
    repairEraTerritoryGrowth(state, map);
    expect(state.territories.med_a).toBeDefined(); // era-1 frontier
    expect(state.territories.disc_a).toBeDefined(); // era-2 frontier
    expect(state.territories.med_a.owner_id).toBeNull(); // appears neutral
    expect(state.map_era_floor).toBe(2);
  });

  it('is a no-op when era advancement is off', () => {
    const map = makeMap();
    const state = makeState([makePlayer('p1', 2)], 0);
    state.settings = {} as GameState['settings'];
    repairEraTerritoryGrowth(state, map);
    expect(state.territories.med_a).toBeUndefined();
  });

  it('is a no-op on a map without growth tags', () => {
    const plain = { ...makeMap(), territories: [mapTerritory('a'), mapTerritory('b')] } as GameMap;
    const state = makeState([makePlayer('p1', 3)], 0);
    state.settings = { era_advancement_enabled: true } as GameState['settings'];
    repairEraTerritoryGrowth(state, plain);
    expect(Object.keys(state.territories).sort()).toEqual(['base_a', 'base_b']);
  });
});

describe('coastal marker (naval_units) on growth territories', () => {
  function seaMap(): GameMap {
    const m = makeMap();
    // med_a becomes an island frontier: reachable only by sea.
    m.connections = [
      { from: 'base_a', to: 'base_b', type: 'land' },
      { from: 'base_b', to: 'med_a', type: 'sea' },
      { from: 'med_a', to: 'disc_a', type: 'land' },
      { from: 'disc_a', to: 'disc_b', type: 'land' },
    ] as GameMap['connections'];
    return m;
  }

  it('marks sea-connected frontiers coastal at unlock (ports become buildable)', () => {
    const map = seaMap();
    const state = makeState([makePlayer('p1', 1)]);
    unlockTerritoriesForFloor(state, map);
    // med_a touches a sea lane → coastal marker present; disc frontiers stay locked.
    expect(state.territories.med_a.naval_units).toBe(0);
  });

  it('leaves landlocked frontiers unmarked', () => {
    const map = seaMap();
    const state = makeState([makePlayer('p1', 2)]);
    unlockTerritoriesForFloor(state, map);
    expect(state.territories.disc_a.naval_units).toBeUndefined();
    expect(state.territories.disc_b.naval_units).toBeUndefined();
  });

  it('repairEraTerritoryGrowth backfills the marker on territories that predate the fix', () => {
    const map = seaMap();
    const state = makeState([makePlayer('p1', 1)]);
    state.settings = { era_advancement_enabled: true } as GameState['settings'];
    // Simulate a frontier inserted before the marker existed.
    state.territories.med_a = {
      territory_id: 'med_a', owner_id: null, unit_count: 3, unit_type: 'infantry', region_id: 'r1',
    };
    // base_b is coastal on this map but was seeded without the marker too.
    repairEraTerritoryGrowth(state, map);
    expect(state.territories.med_a.naval_units).toBe(0);
    expect(state.territories.base_b.naval_units).toBe(0);
    expect(state.territories.base_a.naval_units).toBeUndefined(); // landlocked stays unmarked
  });
});

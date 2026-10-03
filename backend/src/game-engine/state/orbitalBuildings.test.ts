/**
 * Orbital infrastructure (docs/GALACTIC_AGE_BUILDINGS.md §4): in a game with
 * `galaxy_orbital_buildings`, a gateway's buildings survive capture and pass to
 * the captor. Every other tile, and every game without the setting, keeps the
 * raze-everything-but-wonders rule exactly as it was.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState, TerritoryState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { onTerritoryCapture } from './economyManager';
import { normalizeGameSettings } from './gameSettings';
import { unlockTerritoriesForFloor } from '../eraAdvancement/territoryUnlock';
import { GALAXY_MODE_LANE_SOURCE } from './galaxyRing';
import {
  authoredGatewayTerritoryIds,
  buildingsSurviveCapture,
  orbitalBuildingsEnabled,
  stampGatewayTerritories,
} from './orbitalBuildings';

const GALAXY = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;
const ASCENSION = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ascension_galaxy.json'), 'utf-8'),
) as GameMap;

/** The sixteen gateway tiles of the authored ring, from the lanes themselves. */
const RING_GATEWAYS = new Set(
  GALAXY.connections.filter((c) => c.type === 'orbit').flatMap((c) => [c.from, c.to]),
);

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function galaxyGame(factions: string[], overrides: Partial<GameSettings> = {}): GameState {
  const map = JSON.parse(JSON.stringify(GALAXY)) as GameMap;
  const players = factions.map((faction_id, i) => ({
    player_id: `p_${faction_id}`, player_index: i, username: faction_id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id,
  }));
  return initializeGameState('t_orbital', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
}

const FOUR = ['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians'];

function territory(overrides: Partial<TerritoryState> = {}): TerritoryState {
  return {
    territory_id: 'g1', owner_id: 'p2', unit_count: 2, unit_type: 'infantry',
    buildings: ['production_2', 'defense_1', 'jump_gate'],
    building_eras: { production_2: 0, defense_1: 0, jump_gate: 0 },
    naval_units: 3,
    ...overrides,
  };
}

function captureState(t: TerritoryState, overrides: Partial<GameSettings> = {}): GameState {
  return {
    era: 'galaxy_age',
    players: [{ player_id: 'p1' }, { player_id: 'p2' }],
    territories: { [t.territory_id]: t },
    settings: { economy_enabled: true, galaxy_orbital_buildings: true, ...overrides },
  } as unknown as GameState;
}

describe('the predicate', () => {
  it('reads the baked setting and the territory stamp together', () => {
    expect(orbitalBuildingsEnabled({ settings: {} } as GameState)).toBe(false);
    expect(orbitalBuildingsEnabled({ settings: { galaxy_orbital_buildings: true } } as GameState)).toBe(true);
    const on = { settings: { galaxy_orbital_buildings: true } } as GameState;
    expect(buildingsSurviveCapture(on, { gateway: true })).toBe(true);
    expect(buildingsSurviveCapture(on, {})).toBe(false);
    expect(buildingsSurviveCapture({ settings: {} } as GameState, { gateway: true })).toBe(false);
  });
});

describe('which tiles are gateways', () => {
  it('both ends of every authored lane: the sixteen of the ring', () => {
    const ids = authoredGatewayTerritoryIds(GALAXY);
    expect(ids.size).toBe(16);
    expect([...ids].sort()).toEqual([...RING_GATEWAYS].sort());
  });

  it('ignores engine-added lanes: a Jump Gate, a surge or a Colonies bridge', () => {
    const map = JSON.parse(JSON.stringify(GALAXY)) as GameMap;
    map.connections.push(
      { from: 'sol_sahara', to: 'rust_ferrous_shelf', type: 'orbit', source: 'jump_gate' },
      { from: 'sol_sahara', to: 'nexus_chorus_hall', type: 'orbit', source: 'lane_surge' },
      { from: 'verdan_chlorophage_span', to: 'rust_ferrous_shelf', type: 'orbit', source: GALAXY_MODE_LANE_SOURCE },
    );
    const ids = authoredGatewayTerritoryIds(map);
    expect(ids.size).toBe(16);
    expect(ids.has('sol_sahara')).toBe(false);
    expect(ids.has('rust_ferrous_shelf')).toBe(false);
  });

  it('stamps only the tiles in play, and leaves the rest untouched', () => {
    const territories: Record<string, TerritoryState> = {
      sol_guinea: territory({ territory_id: 'sol_guinea' }),
      sol_sahara: territory({ territory_id: 'sol_sahara' }),
    };
    stampGatewayTerritories(territories, GALAXY);
    expect(territories.sol_guinea.gateway).toBe(true);
    expect(territories.sol_sahara.gateway).toBeUndefined();
  });
});

describe('at init', () => {
  it('marks the sixteen gateways when the game plays the rule', () => {
    const state = galaxyGame(FOUR, { galaxy_orbital_buildings: true });
    const stamped = Object.values(state.territories).filter((t) => t.gateway).map((t) => t.territory_id);
    expect(stamped.sort()).toEqual([...RING_GATEWAYS].sort());
    expect(Object.values(state.territories).some((t) => t.gateway === false)).toBe(false);
  });

  it('stamps nothing without the setting: the state shape every other game has', () => {
    const state = galaxyGame(FOUR);
    expect(Object.values(state.territories).some((t) => 'gateway' in t)).toBe(false);
  });

  it('a Colonies board (three seats) adds bridging lanes but no gateways', () => {
    const state = galaxyGame(FOUR.slice(0, 3), { galaxy_orbital_buildings: true });
    const stamped = Object.values(state.territories).filter((t) => t.gateway).map((t) => t.territory_id);
    expect(stamped.sort()).toEqual([...RING_GATEWAYS].sort());
  });

  it('a gateway arriving with its world (Space to Stars) gets the same stamp', () => {
    const state = {
      settings: { galaxy_orbital_buildings: true, era_advancement_enabled: true },
      players: [{ player_id: 'p1', current_era_index: 1 }],
      territories: {},
      map_era_floor: 0,
    } as unknown as GameState;
    const added = unlockTerritoriesForFloor(state, ASCENSION);
    expect(added).toContain('verdan_photic_crown');
    expect(state.territories.verdan_photic_crown.gateway).toBe(true);
    expect(state.territories.verdan_chlorophage_span.gateway).toBe(true);
    const interior = added.filter((id) => id.startsWith('verdan_') && !state.territories[id].gateway);
    expect(interior.length).toBeGreaterThan(0);

    // Without the setting the arrivals carry no stamp either.
    const off = { ...state, settings: { era_advancement_enabled: true }, territories: {}, map_era_floor: 0 } as GameState;
    unlockTerritoriesForFloor(off, ASCENSION);
    expect(Object.values(off.territories).some((t) => 'gateway' in t)).toBe(false);
  });
});

describe('on capture', () => {
  it('a gateway keeps its buildings and their era stamps; the fleet is still lost', () => {
    const t = territory({ gateway: true });
    const state = captureState(t);
    t.owner_id = 'p1';
    onTerritoryCapture(state, 'g1');
    expect(t.buildings).toEqual(['production_2', 'defense_1', 'jump_gate']);
    expect(t.building_eras).toEqual({ production_2: 0, defense_1: 0, jump_gate: 0 });
    expect(t.naval_units).toBe(0);
  });

  it('an interior tile is razed as before, wonders aside', () => {
    const t = territory({ buildings: ['production_2', 'wonder_hyperlane_anchor'] });
    onTerritoryCapture(captureState(t), 'g1');
    expect(t.buildings).toEqual(['wonder_hyperlane_anchor']);
    expect(t.building_eras).toBeUndefined();
    expect(t.naval_units).toBe(0);
  });

  it('a gateway in a game without the setting is razed as before', () => {
    const t = territory({ gateway: true });
    onTerritoryCapture(captureState(t, { galaxy_orbital_buildings: undefined }), 'g1');
    expect(t.buildings).toEqual([]);
    expect(t.building_eras).toBeUndefined();
  });

  it('with the economy off nothing building-side changes either way', () => {
    const t = territory({ gateway: true });
    onTerritoryCapture(captureState(t, { economy_enabled: false }), 'g1');
    expect(t.buildings).toEqual(['production_2', 'defense_1', 'jump_gate']);
    expect(t.naval_units).toBe(0);
  });
});

describe('settings', () => {
  it('normalizes galaxy_orbital_buildings as present only when on', () => {
    expect(normalizeGameSettings({}).galaxy_orbital_buildings).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_orbital_buildings: false }).galaxy_orbital_buildings).toBeUndefined();
    const on = normalizeGameSettings({ galaxy_orbital_buildings: true });
    expect(on.galaxy_orbital_buildings).toBe(true);
    expect(normalizeGameSettings(on).galaxy_orbital_buildings).toBe(true);
  });
});

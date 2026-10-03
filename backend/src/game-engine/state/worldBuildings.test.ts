/**
 * Galactic Age world buildings (docs/GALACTIC_AGE_BUILDINGS.md §7): a Habitat
 * Dome on the Cradle, a Storm Shelter in the storms, a Vault Conduit on the
 * Vault and a Toll Beacon on any gateway. Opened by Lattice Logistics only under
 * `galaxy_world_buildings`; a game without the setting is today's game.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GALAXY_WORLD_BUILDING_IDS } from '@borderfall/shared';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { applyBuild, collectProduction, DEFAULT_BUILDING_COSTS, onTerritoryCapture, validateBuild } from './economyManager';
import { applyCradleMuster, applyStormAttrition } from './worldRules';
import {
  checkWorldBuildingPlacement,
  tollBeaconProductionIncome,
  vaultConduitTechIncome,
} from './worldBuildings';
import { eraTechTreeOptions, getEraTechTree } from '../eras';
import { GALAXY_AGE_TECH_TREE, GALAXY_WORLD_BUILDING_UNLOCKS, galaxyAgeTechTree } from '../eras/galaxyage';
import { isBuildingTechUnlocked } from '../eraAdvancement/buildingHeritage';
import { aiWorldBuildingCandidates, AI_MAX_HABITAT_DOMES } from '../ai/aiWorldBuildings';
import { selectAiBuildingPlacement } from '../ai/aiBot';

const GALAXY = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

/** A Sol gateway and the Verdan gateway at the other end of its lane. */
const SOL_GATE = 'sol_guinea';
const VERDAN_GATE = 'verdan_chlorophage_span';
const SOL_INLAND = 'sol_columbia';
const VERDAN_INLAND = 'verdan_glowmire_shelf';
const RUST_GATE = 'rust_anvil_basin';
const RING = ['nexus_harmonic_rim', 'nexus_gate_threshold', 'nexus_echo_concourse', 'nexus_basin_mandate'];
const NEXUS_INLAND = 'nexus_custodian_quarter';

const FOUR = ['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians'];
const SOL = 'p_stellar_mandate';
const VERDAN = 'p_helion_navigators';

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true, world_rules_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    galaxy_world_buildings: true,
    ...overrides,
  } as unknown as GameSettings;
}

function galaxyGame(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(GALAXY)) as GameMap;
  const players = FOUR.map((faction_id, i) => ({
    player_id: `p_${faction_id}`, player_index: i, username: faction_id, color: '#fff',
    is_ai: true, is_eliminated: false, mmr: 1000, faction_id,
  }));
  const state = initializeGameState('t_world', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  for (const p of state.players) {
    p.special_resource = 30;
    p.unlocked_techs = ['ga_lattice_logistics'];
  }
  // Sol holds its gateway, an inland tile and the Verdan end of the lane.
  for (const id of [SOL_GATE, SOL_INLAND, VERDAN_GATE, VERDAN_INLAND, RUST_GATE]) state.territories[id].owner_id = SOL;
  for (const id of [SOL_GATE, SOL_INLAND, VERDAN_GATE, VERDAN_INLAND, RUST_GATE]) {
    state.territories[id].buildings = [];
    state.territories[id].unit_count = 5;
  }
  return { state, map };
}

const purse = (state: GameState, id: string): number => state.players.find((p) => p.player_id === id)!.special_resource ?? 0;

describe('the tree', () => {
  it('Lattice Logistics opens the four only under the setting, on top of what it opens already', () => {
    const base = GALAXY_AGE_TECH_TREE.find((n) => n.tech_id === 'ga_lattice_logistics')!;
    expect(base.unlocks_buildings ?? []).toEqual([]);
    const world = galaxyAgeTechTree({ worldBuildings: true }).find((n) => n.tech_id === 'ga_lattice_logistics')!;
    expect(world.unlocks_buildings).toEqual([...GALAXY_WORLD_BUILDING_IDS]);
    expect(GALAXY_WORLD_BUILDING_UNLOCKS.ga_lattice_logistics).toEqual([...GALAXY_WORLD_BUILDING_IDS]);
    const both = galaxyAgeTechTree({ buildingsV2: true, worldBuildings: true }).find((n) => n.tech_id === 'ga_lattice_logistics')!;
    expect(both.unlocks_buildings).toEqual(['production_1', 'tech_gen_1', ...GALAXY_WORLD_BUILDING_IDS]);
    // Each combination is built once; nothing else in the tree moves.
    expect(galaxyAgeTechTree({ worldBuildings: true })).toBe(galaxyAgeTechTree({ worldBuildings: true }));
    expect(galaxyAgeTechTree({ worldBuildings: true }).map((n) => [n.tech_id, n.cost, n.tier])).toEqual(
      GALAXY_AGE_TECH_TREE.map((n) => [n.tech_id, n.cost, n.tier]),
    );
  });

  it('is selected per game from its settings', () => {
    expect(eraTechTreeOptions({ galaxy_world_buildings: true })).toEqual({
      galaxyBuildingsV2: false, galaxyPowers: false, galaxyWorldBuildings: true,
    });
    expect(getEraTechTree('galaxy_age', { galaxyWorldBuildings: true })).toBe(galaxyAgeTechTree({ worldBuildings: true }));
    expect(getEraTechTree('space_age', { galaxyWorldBuildings: true })).toBe(getEraTechTree('space_age'));
  });

  it('gates the four behind Lattice Logistics', () => {
    const { state } = galaxyGame();
    state.players[0].unlocked_techs = [];
    for (const b of GALAXY_WORLD_BUILDING_IDS) expect(isBuildingTechUnlocked(state, SOL, b)).toBe(false);
    state.players[0].unlocked_techs = ['ga_lattice_logistics'];
    for (const b of GALAXY_WORLD_BUILDING_IDS) expect(isBuildingTechUnlocked(state, SOL, b)).toBe(true);
  });
});

describe('the gateway stamp', () => {
  it('marks every gateway with the far end of its authored lane, only under the setting', () => {
    const { state } = galaxyGame();
    expect(state.territories[SOL_GATE].lane_partners).toEqual([VERDAN_GATE]);
    expect(state.territories[VERDAN_GATE].lane_partners).toEqual([SOL_GATE]);
    expect(state.territories[SOL_INLAND].lane_partners).toBeUndefined();
    const stamped = Object.values(state.territories).filter((t) => t.lane_partners).length;
    expect(stamped).toBe(16);
    const off = galaxyGame({ galaxy_world_buildings: undefined });
    expect(Object.values(off.state.territories).some((t) => t.lane_partners)).toBe(false);
  });
});

describe('placement', () => {
  it('stands each building only where its world rule is', () => {
    const { state } = galaxyGame();
    expect(validateBuild(state, SOL, SOL_INLAND, 'habitat_dome').valid).toBe(true);
    expect(validateBuild(state, SOL, VERDAN_INLAND, 'habitat_dome').error).toMatch(/only on the Cradle world/);
    expect(validateBuild(state, SOL, VERDAN_INLAND, 'storm_shelter').valid).toBe(true);
    expect(validateBuild(state, SOL, SOL_INLAND, 'storm_shelter').error).toMatch(/only on the storm world/);
    expect(validateBuild(state, SOL, SOL_GATE, 'toll_beacon').valid).toBe(true);
    expect(validateBuild(state, SOL, SOL_INLAND, 'toll_beacon').error).toMatch(/only on a gateway/);
    // The Vault: a Gate Ring tile, not any Nexus tile.
    state.territories[RING[0]].owner_id = SOL;
    state.territories[NEXUS_INLAND].owner_id = SOL;
    expect(validateBuild(state, SOL, RING[0], 'vault_conduit').valid).toBe(true);
    expect(validateBuild(state, SOL, NEXUS_INLAND, 'vault_conduit').error).toMatch(/only on a Vault tile/);
  });

  it("carries one Toll Beacon a lane: the corridor's other end is refused", () => {
    const { state } = galaxyGame();
    applyBuild(state, SOL, SOL_GATE, 'toll_beacon');
    expect(validateBuild(state, SOL, VERDAN_GATE, 'toll_beacon').error).toMatch(/already carries a Toll Beacon/);
    // Whoever holds the far end: a rival's beacon there blocks it too.
    const other = galaxyGame();
    other.state.territories[VERDAN_GATE].owner_id = VERDAN;
    other.state.territories[VERDAN_GATE].buildings = ['toll_beacon'];
    expect(validateBuild(other.state, SOL, SOL_GATE, 'toll_beacon').error).toMatch(/already carries a Toll Beacon/);
  });

  it('is its own one-per-tile category, beside the standard buildings', () => {
    const { state } = galaxyGame();
    state.territories[SOL_GATE].buildings = ['defense_1', 'production_1'];
    expect(validateBuild(state, SOL, SOL_GATE, 'toll_beacon').valid).toBe(true);
    applyBuild(state, SOL, SOL_GATE, 'toll_beacon');
    expect(state.territories[SOL_GATE].buildings).toEqual(['defense_1', 'production_1', 'toll_beacon']);
    expect(validateBuild(state, SOL, SOL_GATE, 'toll_beacon').error).toMatch(/already has a toll_beacon/);
    expect(validateBuild(state, SOL, SOL_GATE, 'habitat_dome').valid).toBe(true);
  });

  it('costs its price through the world multiplier: a Rust gateway builds at half', () => {
    const { state } = galaxyGame();
    applyBuild(state, SOL, SOL_GATE, 'toll_beacon');
    expect(purse(state, SOL)).toBe(24);
    applyBuild(state, SOL, RUST_GATE, 'toll_beacon');
    expect(purse(state, SOL)).toBe(21);
    state.players[0].special_resource = 4;
    expect(validateBuild(state, SOL, SOL_INLAND, 'habitat_dome').error).toMatch(/need 5, have 4/);
  });

  it('keeps its own price when an economy snapshot predates it', () => {
    const { state } = galaxyGame();
    const legacy = Object.fromEntries(
      Object.entries(DEFAULT_BUILDING_COSTS).filter(([id]) => !(GALAXY_WORLD_BUILDING_IDS as readonly string[]).includes(id)),
    );
    state.settings.economy_snapshot = { building_costs: legacy, production_income: { production_1: 1 } } as never;
    expect(validateBuild(state, SOL, SOL_GATE, 'toll_beacon').valid).toBe(true);
    applyBuild(state, SOL, SOL_GATE, 'toll_beacon');
    expect(purse(state, SOL)).toBe(24);
  });

  it('is refused on every path in a game without the setting', () => {
    const { state } = galaxyGame({ galaxy_world_buildings: undefined });
    for (const b of GALAXY_WORLD_BUILDING_IDS) {
      expect(validateBuild(state, SOL, SOL_GATE, b).error).toBe('World buildings are not part of this game');
    }
    expect(checkWorldBuildingPlacement(state, state.territories[SOL_GATE], 'defense_1')).toBeNull();
  });
});

describe('the world rules read them', () => {
  it('a Habitat Dome musters its tile to 3 instead of 2, on the muster round', () => {
    const { state } = galaxyGame();
    state.territories[SOL_INLAND].unit_count = 2;
    state.territories[SOL_INLAND].buildings = ['habitat_dome'];
    state.territories['sol_pacifica'].owner_id = SOL;
    state.territories['sol_pacifica'].unit_count = 2;
    state.turn_number = 4;
    applyCradleMuster(state);
    expect(state.territories[SOL_INLAND].unit_count).toBe(2);
    state.turn_number = 5;
    applyCradleMuster(state);
    expect(state.territories[SOL_INLAND].unit_count).toBe(3);
    expect(state.territories['sol_pacifica'].unit_count).toBe(2);
  });

  it('a Storm Shelter keeps its tile out of the storms up to 18', () => {
    const { state } = galaxyGame();
    state.territories[VERDAN_INLAND].unit_count = 15;
    state.territories[VERDAN_INLAND].buildings = ['storm_shelter'];
    state.territories['verdan_spore_reach'].owner_id = SOL;
    state.territories['verdan_spore_reach'].unit_count = 15;
    applyStormAttrition(state);
    expect(state.territories[VERDAN_INLAND].unit_count).toBe(15);
    expect(state.territories['verdan_spore_reach'].unit_count).toBe(14);
    state.territories[VERDAN_INLAND].unit_count = 20;
    applyStormAttrition(state);
    expect(state.territories[VERDAN_INLAND].unit_count).toBe(19);
  });

  it('reads nothing in a game without the setting, whatever stands on the tile', () => {
    const { state } = galaxyGame({ galaxy_world_buildings: undefined });
    state.territories[VERDAN_INLAND].unit_count = 15;
    state.territories[VERDAN_INLAND].buildings = ['storm_shelter'];
    applyStormAttrition(state);
    expect(state.territories[VERDAN_INLAND].unit_count).toBe(14);
  });
});

describe('income', () => {
  it('a Toll Beacon pays 1 PP a turn while its lane is its owner\'s corridor', () => {
    const { state } = galaxyGame();
    state.territories[SOL_GATE].buildings = ['toll_beacon'];
    expect(tollBeaconProductionIncome(state, SOL)).toBe(1);
    const withToll = collectProduction(state, SOL).productionEarned;
    state.territories[VERDAN_GATE].owner_id = VERDAN;
    expect(tollBeaconProductionIncome(state, SOL)).toBe(0);
    state.territories[VERDAN_GATE].owner_id = SOL;
    state.territories[SOL_GATE].buildings = [];
    expect(collectProduction(state, SOL).productionEarned).toBe(withToll - 1);
  });

  it('a Vault Conduit pays 1 TP a turn while its owner holds the whole Vault', () => {
    const { state } = galaxyGame();
    for (const id of RING) state.territories[id].owner_id = SOL;
    state.territories[RING[0]].buildings = ['vault_conduit'];
    state.territories[RING[1]].buildings = ['vault_conduit'];
    expect(vaultConduitTechIncome(state, SOL)).toBe(2);
    state.territories[RING[3]].owner_id = VERDAN;
    expect(vaultConduitTechIncome(state, SOL)).toBe(0);
    expect(vaultConduitTechIncome(state, VERDAN)).toBe(0);
  });

  it('pays nothing in a game without the setting', () => {
    const { state } = galaxyGame({ galaxy_world_buildings: undefined });
    state.territories[SOL_GATE].buildings = ['toll_beacon'];
    state.territories[SOL_GATE].lane_partners = [VERDAN_GATE];
    expect(tollBeaconProductionIncome(state, SOL)).toBe(0);
  });
});

describe('capture', () => {
  it('follows Phase 2: razed on capture, kept on a gateway under orbital infrastructure', () => {
    const plain = galaxyGame();
    plain.state.territories[SOL_GATE].buildings = ['toll_beacon'];
    onTerritoryCapture(plain.state, SOL_GATE);
    expect(plain.state.territories[SOL_GATE].buildings).toEqual([]);
    const orbital = galaxyGame({ galaxy_orbital_buildings: true });
    orbital.state.territories[SOL_GATE].buildings = ['toll_beacon'];
    onTerritoryCapture(orbital.state, SOL_GATE);
    expect(orbital.state.territories[SOL_GATE].buildings).toEqual(['toll_beacon']);
  });
});

describe('the bots', () => {
  it('shelter a stack at the storm line, tax a corridor, and dome a thin frontier Cradle tile', () => {
    const { state, map } = galaxyGame();
    // A Verdan stack at the storm line, and a lane held at both ends.
    state.territories[VERDAN_INLAND].unit_count = 12;
    const picks = aiWorldBuildingCandidates(state, map, SOL);
    expect(picks.map((p) => p.buildingType)).toEqual(['storm_shelter', 'toll_beacon']);
    expect(picks[0]!.candidates).toEqual([VERDAN_INLAND]);
    // Both ends of the Sol–Verdan lane are Sol's: either end may carry the toll,
    // and once one does, the other is no longer offered.
    expect(picks[1]!.candidates.sort()).toEqual([SOL_GATE, VERDAN_GATE].sort());
    state.territories[SOL_GATE].buildings = ['toll_beacon'];
    expect(aiWorldBuildingCandidates(state, map, SOL).some((p) => p.buildingType === 'toll_beacon')).toBe(false);
    state.territories[SOL_GATE].buildings = [];
    // A thin Sol tile facing a rival.
    state.territories['sol_pacifica'].owner_id = SOL;
    state.territories['sol_pacifica'].unit_count = 1;
    state.territories['sol_pacifica'].buildings = [];
    const pacificaFoes = map.connections
      .filter((c) => c.from === 'sol_pacifica' || c.to === 'sol_pacifica')
      .map((c) => (c.from === 'sol_pacifica' ? c.to : c.from));
    state.territories[pacificaFoes[0]!].owner_id = VERDAN;
    const domes = aiWorldBuildingCandidates(state, map, SOL).find((p) => p.buildingType === 'habitat_dome');
    expect(domes?.candidates).toContain('sol_pacifica');
    expect(AI_MAX_HABITAT_DOMES).toBe(3);
  });

  it('lay conduits only while holding the whole Vault, and build through the same selector', () => {
    const { state, map } = galaxyGame();
    for (const id of RING) state.territories[id].owner_id = SOL;
    expect(aiWorldBuildingCandidates(state, map, SOL).find((p) => p.buildingType === 'vault_conduit')?.candidates)
      .toEqual([...RING].sort());
    state.territories[RING[2]].owner_id = VERDAN;
    expect(aiWorldBuildingCandidates(state, map, SOL).some((p) => p.buildingType === 'vault_conduit')).toBe(false);
    // Through the real selector, which validates: an expert bot raises one.
    for (const id of RING) state.territories[id].owner_id = SOL;
    const pick = selectAiBuildingPlacement(state, map, SOL, 'expert');
    expect(pick && (GALAXY_WORLD_BUILDING_IDS as readonly string[]).includes(pick.buildingType)).toBe(true);
  });

  it('try nothing in a game without the setting', () => {
    const { state, map } = galaxyGame({ galaxy_world_buildings: undefined });
    state.territories[VERDAN_INLAND].unit_count = 14;
    expect(aiWorldBuildingCandidates(state, map, SOL)).toEqual([]);
  });
});

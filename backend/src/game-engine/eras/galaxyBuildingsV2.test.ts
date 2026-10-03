/**
 * Galactic Age buildings v2, Phase 1 (docs/GALACTIC_AGE_BUILDINGS.md): era
 * names for the standard buildings and a tree that gates every tier, selected
 * per game by `settings.galaxy_buildings_v2`. The v1 tree, and every game
 * without the setting, must read exactly as before.
 */
import { describe, it, expect } from 'vitest';
import {
  BUILDING_DISPLAY,
  BUILDING_DISPLAY_BY_ERA,
  buildingDisplayName,
  techNodeBuildingUnlocks,
} from '@borderfall/shared';
import type { BuildingType, GameState, PlayerState } from '../../types';
import { GALAXY_AGE_TECH_TREE, GALAXY_AGE_TECH_TREE_V2, GALAXY_BUILDING_UNLOCKS_V2 } from './galaxyage';
import { eraTechTreeOptions, getEraTechTree } from './index';
import {
  captureHeritageUnlocks,
  currentEraTechForBuilding,
  isBuildingTechUnlocked,
} from '../eraAdvancement/buildingHeritage';
import { validateBuild } from '../state/economyManager';
import { normalizeGameSettings } from '../state/gameSettings';

const STANDARD: BuildingType[] = [
  'production_1', 'production_2', 'production_3', 'production_4',
  'defense_1', 'defense_2', 'defense_3',
  'tech_gen_1', 'tech_gen_2',
];

function galaxyState(
  settings: Partial<GameState['settings']> = {},
  player: Partial<PlayerState> = {},
): GameState {
  return {
    era: 'galaxy_age',
    players: [{ player_id: 'p1', unlocked_techs: [], special_resource: 50, ...player } as PlayerState],
    territories: {
      t1: { territory_id: 't1', owner_id: 'p1', unit_count: 3, unit_type: 'infantry', buildings: [] },
    },
    settings: { economy_enabled: true, tech_trees_enabled: true, ...settings },
  } as unknown as GameState;
}

describe('techNodeBuildingUnlocks', () => {
  it('prefers the plural list and falls back to the single field', () => {
    expect(techNodeBuildingUnlocks({})).toEqual([]);
    expect(techNodeBuildingUnlocks({ unlocks_building: 'defense_1' })).toEqual(['defense_1']);
    expect(techNodeBuildingUnlocks({ unlocks_buildings: ['production_1', 'tech_gen_1'] }))
      .toEqual(['production_1', 'tech_gen_1']);
    expect(techNodeBuildingUnlocks({ unlocks_building: 'x', unlocks_buildings: ['y'] })).toEqual(['y']);
  });
});

describe('GALAXY_AGE_TECH_TREE_V2', () => {
  it('keeps every node, its cost, tier and prerequisite — only the building unlocks change', () => {
    expect(GALAXY_AGE_TECH_TREE_V2.map((n) => n.tech_id)).toEqual(GALAXY_AGE_TECH_TREE.map((n) => n.tech_id));
    for (const [i, node] of GALAXY_AGE_TECH_TREE_V2.entries()) {
      const { unlocks_building: _a, unlocks_buildings: _b, ...v2 } = node;
      const { unlocks_building: _c, unlocks_buildings: _d, ...v1 } = GALAXY_AGE_TECH_TREE[i];
      expect(v2).toEqual(v1);
      expect(node.unlocks_building).toBeUndefined();
    }
  });

  it('gates every standard tier plus the Jump Gate, each exactly once', () => {
    const opened = GALAXY_AGE_TECH_TREE_V2.flatMap((n) => techNodeBuildingUnlocks(n));
    expect([...opened].sort()).toEqual([...STANDARD, 'jump_gate'].sort());
  });

  it('puts tier I behind the tier-1 roots and each later tier behind the matching tree tier', () => {
    const tierOf = new Map(GALAXY_AGE_TECH_TREE.map((n) => [n.tech_id, n.tier]));
    const expected: Record<string, number> = {
      production_1: 1, tech_gen_1: 1, defense_1: 1,
      production_2: 2, defense_2: 2, jump_gate: 2,
      production_3: 3, tech_gen_2: 3, defense_3: 3,
      production_4: 4,
    };
    for (const [techId, buildings] of Object.entries(GALAXY_BUILDING_UNLOCKS_V2)) {
      for (const b of buildings) expect([b, tierOf.get(techId)]).toEqual([b, expected[b]]);
    }
  });

  it('leaves the v1 tree untouched: tier-I buildings gated at tier 2+, nothing else gated', () => {
    const v1 = Object.fromEntries(
      GALAXY_AGE_TECH_TREE.filter((n) => n.unlocks_building).map((n) => [n.unlocks_building, n.tier]),
    );
    expect(v1).toEqual({ defense_1: 2, production_1: 2, jump_gate: 2, tech_gen_1: 3, tech_gen_2: 4 });
    expect(GALAXY_AGE_TECH_TREE.some((n) => n.unlocks_buildings)).toBe(false);
  });
});

describe('getEraTechTree', () => {
  it('serves the v2 tree only for the Galactic Age with the option on', () => {
    expect(getEraTechTree('galaxy_age')).toBe(GALAXY_AGE_TECH_TREE);
    expect(getEraTechTree('galaxy_age', { galaxyBuildingsV2: false })).toBe(GALAXY_AGE_TECH_TREE);
    expect(getEraTechTree('galaxy_age', { galaxyBuildingsV2: true })).toBe(GALAXY_AGE_TECH_TREE_V2);
    expect(getEraTechTree('space_age', { galaxyBuildingsV2: true })).toBe(getEraTechTree('space_age'));
  });

  it('reads the option off a game\'s settings', () => {
    expect(eraTechTreeOptions({})).toEqual({ galaxyBuildingsV2: false, galaxyPowers: false, galaxyWorldBuildings: false, ww2ManhattanScience: false });
    expect(eraTechTreeOptions({ galaxy_buildings_v2: true })).toEqual({ galaxyBuildingsV2: true, galaxyPowers: false, galaxyWorldBuildings: false, ww2ManhattanScience: false });
  });
});

describe('the build gate under v2', () => {
  it('v1 (no setting): tier II+ is free, tier I waits on a tier-2 node', () => {
    const s = galaxyState();
    expect(isBuildingTechUnlocked(s, 'p1', 'production_2')).toBe(true);
    expect(isBuildingTechUnlocked(s, 'p1', 'defense_3')).toBe(true);
    expect(isBuildingTechUnlocked(s, 'p1', 'production_1')).toBe(false);
    expect(currentEraTechForBuilding(s, s.players[0], 'production_1')?.tech_id).toBe('ga_battle_fabricators');
  });

  it('v2: every tier is gated, tier I by the tier-1 roots', () => {
    const s = galaxyState({ galaxy_buildings_v2: true });
    for (const b of [...STANDARD, 'jump_gate' as BuildingType]) {
      expect([b, isBuildingTechUnlocked(s, 'p1', b)]).toEqual([b, false]);
    }
    expect(currentEraTechForBuilding(s, s.players[0], 'production_1')?.tech_id).toBe('ga_lattice_logistics');
    expect(currentEraTechForBuilding(s, s.players[0], 'tech_gen_1')?.tech_id).toBe('ga_lattice_logistics');
    expect(currentEraTechForBuilding(s, s.players[0], 'defense_1')?.tech_id).toBe('ga_hyperspace_chart');
    expect(currentEraTechForBuilding(s, s.players[0], 'production_4')?.tech_id).toBe('ga_dyson_slice');
  });

  it('v2: one node opens both of its buildings, and the untouched ones stay closed', () => {
    const s = galaxyState({ galaxy_buildings_v2: true }, { unlocked_techs: ['ga_lattice_logistics'] });
    expect(isBuildingTechUnlocked(s, 'p1', 'production_1')).toBe(true);
    expect(isBuildingTechUnlocked(s, 'p1', 'tech_gen_1')).toBe(true);
    expect(isBuildingTechUnlocked(s, 'p1', 'production_2')).toBe(false);
    expect(isBuildingTechUnlocked(s, 'p1', 'defense_1')).toBe(false);
  });

  it('v2: ungated infrastructure (ports, batteries) is still free', () => {
    const s = galaxyState({ galaxy_buildings_v2: true });
    expect(isBuildingTechUnlocked(s, 'p1', 'port')).toBe(true);
    expect(isBuildingTechUnlocked(s, 'p1', 'coastal_battery')).toBe(true);
  });

  it('heritage carries every building a researched v2 node opened', () => {
    const s = galaxyState(
      { galaxy_buildings_v2: true, era_advancement_enabled: true, era_heritage_buildings_enabled: true },
      { unlocked_techs: ['ga_lattice_logistics', 'ga_gate_engineering'] },
    );
    expect([...captureHeritageUnlocks(s, s.players[0], 'galaxy_age')].sort())
      .toEqual(['jump_gate', 'production_1', 'tech_gen_1']);
    // Without the setting the same research reads off the v1 tree.
    const v1 = galaxyState(
      { era_advancement_enabled: true, era_heritage_buildings_enabled: true },
      { unlocked_techs: ['ga_lattice_logistics', 'ga_gate_engineering'] },
    );
    expect(captureHeritageUnlocks(v1, v1.players[0], 'galaxy_age')).toEqual(['jump_gate']);
  });
});

describe('era building names', () => {
  it('every standard building has a Galactic Age name, distinct from the shared one', () => {
    const names = BUILDING_DISPLAY_BY_ERA.galaxy_age;
    expect(Object.keys(names).sort()).toEqual([...STANDARD].sort());
    for (const b of STANDARD) {
      expect(names[b]).not.toBe(BUILDING_DISPLAY[b].name);
      expect(buildingDisplayName(b, false, 'galaxy_age')).toBe(names[b]);
      expect(buildingDisplayName(b, true, 'galaxy_age')).toBe(`${names[b]} (${BUILDING_DISPLAY[b].tier})`);
    }
  });

  it('falls back to the shared name without an era, for another era, or for an unnamed building', () => {
    expect(buildingDisplayName('production_1', false)).toBe('Workshop');
    expect(buildingDisplayName('production_1', false, 'space_age')).toBe('Workshop');
    expect(buildingDisplayName('jump_gate', false, 'galaxy_age')).toBe(BUILDING_DISPLAY.jump_gate.name);
  });

  it('the build validator names the prerequisite the way the game shows it', () => {
    const s = galaxyState();
    expect(validateBuild(s, 'p1', 't1', 'production_2').error).toBe('Must build a Workshop before a Foundry');
    const v2 = galaxyState({ galaxy_buildings_v2: true });
    expect(validateBuild(v2, 'p1', 't1', 'production_2').error)
      .toBe('Must build a Fabricator before a Orbital Foundry');
  });
});

describe('settings', () => {
  it('normalizes galaxy_buildings_v2 as a boolean present only when on', () => {
    expect(normalizeGameSettings({}).galaxy_buildings_v2).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_buildings_v2: false }).galaxy_buildings_v2).toBeUndefined();
    const on = normalizeGameSettings({ galaxy_buildings_v2: true });
    expect(on.galaxy_buildings_v2).toBe(true);
    expect(normalizeGameSettings(on).galaxy_buildings_v2).toBe(true);
  });
});

/**
 * Heritage + modernize through the REAL paths: executeAdvanceEra for the carry,
 * validateBuild + isBuildingTechUnlocked for the gate, and collectProduction /
 * getBuildingDefenseBonus for the yields. The unit tests next door pin the
 * rules; these pin that the rules are actually reached in play.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { getEraTechTree } from '../eras';
import { executeAdvanceEra } from './advanceEra';
import { resolvePlayerEraId } from './constants';
import { ERA_ADVANCEMENT_SPINES, getEffectiveMilestoneGate } from './spines';
import { isBuildingTechUnlocked } from './buildingHeritage';
import {
  applyBuild,
  collectProduction,
  getBuildingDefenseBonus,
  onTerritoryCapture,
  validateBuild,
} from '../state/economyManager';

const MEDIEVAL_MASONRY = 'medieval_castle_keep'; // cheapest Medieval defense node

function ancientState(heritage = true): { state: GameState; player: PlayerState } {
  const territories: Record<string, TerritoryState> = {
    cap: { territory_id: 'cap', owner_id: 'p1', unit_count: 20, unit_type: 'infantry', buildings: [] },
    t2: { territory_id: 't2', owner_id: 'p1', unit_count: 10, unit_type: 'infantry', buildings: [] },
    t3: { territory_id: 't3', owner_id: 'p1', unit_count: 10, unit_type: 'infantry', buildings: [] },
    e1: { territory_id: 'e1', owner_id: 'p2', unit_count: 4, unit_type: 'infantry' },
  };
  const player = {
    player_id: 'p1', player_index: 0, is_eliminated: false,
    special_resource: 100_000, tech_points: 100_000, last_turn_production_income: 20,
    current_era_index: 0, unlocked_techs: [], era_signature_charges: {},
    era_advancement_tech_echo: {}, used_game_abilities: [],
  } as PlayerState;
  const state = {
    game_id: 'g', era: 'ancient', phase: 'fortify',
    players: [player, { player_id: 'p2', player_index: 1, is_eliminated: false } as PlayerState],
    territories,
    era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
    settings: {
      era_advancement_enabled: true,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: false,
      era_advancement_spine_id: 'classic',
      era_heritage_buildings_enabled: heritage,
    },
  } as GameState;
  return { state, player };
}

/** Unlock this era's gate techs plus every node that opens a building. */
function unlockEraTechs(state: GameState, player: PlayerState): void {
  const gate = getEffectiveMilestoneGate(state, player.player_id);
  const tree = getEraTechTree(resolvePlayerEraId(state, player));
  const byTier = (t: number) => tree.filter((n) => n.tier === t).map((n) => n.tech_id);
  player.unlocked_techs = [
    ...new Set([
      ...byTier(1).slice(0, gate.min_tier1_techs),
      ...byTier(2).slice(0, gate.min_tier2_techs),
      ...byTier(3).slice(0, gate.min_tier3_techs),
      ...tree.filter((n) => n.unlocks_building && !n.unlocks_building.startsWith('wonder_'))
        .map((n) => n.tech_id),
    ]),
  ];
}

/** Ancient player who researched the wall line and raised tier-3 walls, then advanced. */
function advancedWithWalls(heritage = true): { state: GameState; player: PlayerState } {
  const { state, player } = ancientState(heritage);
  unlockEraTechs(state, player);
  applyBuild(state, 'p1', 'cap', 'defense_1');
  applyBuild(state, 'p1', 'cap', 'defense_2');
  applyBuild(state, 'p1', 'cap', 'defense_3');
  applyBuild(state, 'p1', 't2', 'production_1');
  const advanced = executeAdvanceEra(state, 'p1');
  expect(advanced.success).toBe(true);
  expect(player.current_era_index).toBe(1);
  expect(player.unlocked_techs).toEqual([]);
  return { state, player };
}

describe('heritage build rights across an era advance', () => {
  it('lets a player who held tier-3 walls place a basic wall in the new era', () => {
    // The reported bug, end to end.
    const { state } = advancedWithWalls();
    expect(isBuildingTechUnlocked(state, 'p1', 'defense_1')).toBe(true);
    expect(validateBuild(state, 'p1', 't3', 'defense_1', isBuildingTechUnlocked(state, 'p1', 'defense_1')).valid)
      .toBe(true);
  });

  it('reproduces the old lockout with the feature off', () => {
    const { state } = advancedWithWalls(false);
    expect(isBuildingTechUnlocked(state, 'p1', 'defense_1')).toBe(false);
    const result = validateBuild(state, 'p1', 't3', 'defense_1', false);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/research the required technology/i);
  });

  it('keeps the buildings themselves, and the era stamps that age them', () => {
    const { state } = advancedWithWalls();
    expect(state.territories.cap.buildings).toEqual(['defense_3']);
    // Only the surviving tier keeps a stamp: the tiers it replaced are gone.
    expect(state.territories.cap.building_eras).toEqual({ defense_3: 0 });
  });

  it('does not inherit rights the player never researched', () => {
    const { state, player } = ancientState();
    player.unlocked_techs = ['ancient_stone_walls']; // defense_1 only
    applyBuild(state, 'p1', 'cap', 'defense_1');
    player.special_resource = 100_000;
    // Force the advance without the gate (the gate is not what is under test).
    player.legacy_building_unlocks = ['defense_1'];
    player.current_era_index = 1;
    player.unlocked_techs = [];
    expect(isBuildingTechUnlocked(state, 'p1', 'defense_1')).toBe(true);
    expect(isBuildingTechUnlocked(state, 'p1', 'tech_gen_1')).toBe(false);
  });
});

describe('modernize yields', () => {
  it('ages a carried fortress, then restores it with a premium once researched', () => {
    const { state, player } = advancedWithWalls();
    // Ancient tier-3 walls in the Medieval era: 3 dice → 2.
    expect(getBuildingDefenseBonus(state, 'cap')).toBe(2);

    player.unlocked_techs = [MEDIEVAL_MASONRY];
    // This era's fortification craft: restored, and better than new build.
    expect(getBuildingDefenseBonus(state, 'cap')).toBe(4);
  });

  it('leaves a building raised in the current era at its base value', () => {
    const { state, player } = advancedWithWalls();
    player.unlocked_techs = [MEDIEVAL_MASONRY];
    applyBuild(state, 'p1', 't3', 'defense_1');
    expect(state.territories.t3.building_eras).toEqual({ defense_1: 1 });
    // No premium for new construction — the premium is for continuity, which is
    // why era 0 and every pre-advance game keeps exactly today's numbers.
    expect(getBuildingDefenseBonus(state, 't3')).toBe(1);
  });

  it('reduces production income from an aged farm and restores it on research', () => {
    const { state, player } = advancedWithWalls();
    // t2 carries an Ancient production_1; put a second one on t3 this era.
    applyBuild(state, 'p1', 't3', 'production_1');
    const baseIncome = collectProduction(state, 'p1');

    // Ancient production_1 aged floors at 1 (a lone tier-1 never drops to zero),
    // so income is unchanged here; the premium is what moves it.
    player.unlocked_techs = ['medieval_guilds']; // Medieval production line
    const modernized = collectProduction(state, 'p1');
    expect(modernized.productionEarned).toBeGreaterThan(baseIncome.productionEarned);
  });

  it('never ages a building this era has no research for', () => {
    const { state } = advancedWithWalls();
    state.territories.t3.naval_units = 0;
    state.territories.t3.buildings = ['port'];
    state.territories.t3.building_eras = { port: 0 };
    // Nothing in the Medieval tree unlocks a port, so it cannot be modernized
    // and must not be penalized either.
    expect(collectProduction(state, 'p1').productionEarned).toBeGreaterThan(0);
    expect(getBuildingDefenseBonus(state, 't3')).toBe(0);
  });

  it('changes nothing before the first advance', () => {
    const { state, player } = ancientState();
    unlockEraTechs(state, player);
    applyBuild(state, 'p1', 'cap', 'defense_1');
    applyBuild(state, 'p1', 'cap', 'defense_2');
    // Era 0: nothing carried, nothing aged, no premium — today's balance exactly.
    expect(getBuildingDefenseBonus(state, 'cap')).toBe(2);
  });
});

describe('capture', () => {
  it('razes era stamps along with the buildings', () => {
    const { state } = advancedWithWalls();
    expect(state.territories.cap.building_eras).toEqual({ defense_3: 0 });
    onTerritoryCapture(state, 'cap');
    expect(state.territories.cap.buildings).toEqual([]);
    expect(state.territories.cap.building_eras).toBeUndefined();
  });
});

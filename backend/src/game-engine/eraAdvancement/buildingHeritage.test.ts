/**
 * Heritage building rights + the modernize rule.
 *
 * The behavior being locked in: advancing an era wipes `unlocked_techs`, and
 * the build gate reads the ARRIVING era's tree, so a player who held tier-3
 * walls in the Ancient era could not place a tier-1 wall in the Medieval era
 * until they re-bought that era's first wall tech — while their existing tier-3
 * walls kept working untouched. Heritage keeps the build RIGHT; the arriving
 * era's tech becomes what modernizes the buildings instead of what permits them.
 */
import { describe, it, expect } from 'vitest';
import type { BuildingType, GameState, PlayerState, TerritoryState } from '../../types';
import {
  agedYield,
  buildingModernization,
  captureHeritageUnlocks,
  currentEraTechForBuilding,
  effectiveBuildingYield,
  heritageEnabled,
  isBuildingTechUnlocked,
  stampBuildingEra,
  clearAllBuildingEras,
  storeHeritageUnlocks,
} from './buildingHeritage';

const ANCIENT_WALLS = 'ancient_stone_walls';   // unlocks defense_1
const ANCIENT_GRANARIES = 'ancient_granaries'; // unlocks production_1
const MEDIEVAL_KEEP = 'medieval_castle_keep';  // unlocks defense_1

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'p1',
    current_era_index: 0,
    unlocked_techs: [],
    ...overrides,
  } as PlayerState;
}

function territory(overrides: Partial<TerritoryState> = {}): TerritoryState {
  return {
    territory_id: 't1',
    owner_id: 'p1',
    unit_count: 1,
    unit_type: 'infantry',
    buildings: [],
    ...overrides,
  } as TerritoryState;
}

function state(
  players: PlayerState[],
  settings: Partial<GameState['settings']> = {},
  territories: Record<string, TerritoryState> = {},
): GameState {
  return {
    era: 'ancient',
    players,
    territories,
    settings: {
      era_advancement_enabled: true,
      tech_trees_enabled: true,
      economy_enabled: true,
      era_heritage_buildings_enabled: true,
      ...settings,
    },
  } as GameState;
}

describe('heritageEnabled', () => {
  it('requires its own flag AND era advancement AND tech trees', () => {
    const p = player();
    expect(heritageEnabled(state([p]))).toBe(true);
    expect(heritageEnabled(state([p], { era_heritage_buildings_enabled: false }))).toBe(false);
    expect(heritageEnabled(state([p], { era_advancement_enabled: false }))).toBe(false);
    // No research at all means nothing gates a building, so aging one would be
    // a penalty with no way to lift it.
    expect(heritageEnabled(state([p], { tech_trees_enabled: false }))).toBe(false);
  });
});

describe('captureHeritageUnlocks', () => {
  it('collects the buildings the departing era’s researched techs opened', () => {
    const p = player({ unlocked_techs: [ANCIENT_WALLS, ANCIENT_GRANARIES] });
    expect(captureHeritageUnlocks(state([p]), p, 'ancient').sort())
      .toEqual(['defense_1', 'production_1']);
  });

  it('ignores unresearched nodes and era wonders', () => {
    const p = player({ unlocked_techs: [ANCIENT_WALLS] });
    const captured = captureHeritageUnlocks(state([p]), p, 'ancient');
    expect(captured).toEqual(['defense_1']);
    expect(captured.some((b) => b.startsWith('wonder_'))).toBe(false);
  });

  it('merges into the permanent set without duplicating', () => {
    const p = player({ legacy_building_unlocks: ['defense_1'] });
    storeHeritageUnlocks(p, ['defense_1', 'production_1']);
    storeHeritageUnlocks(p, []);
    expect(p.legacy_building_unlocks?.sort()).toEqual(['defense_1', 'production_1']);
  });
});

describe('isBuildingTechUnlocked', () => {
  it('lets an inherited right build a basic building in the new era', () => {
    // The exact reported case: tier-3 walls in the Ancient era, then unable to
    // place a tier-1 wall after advancing.
    const p = player({
      current_era_index: 1,
      unlocked_techs: [],
      legacy_building_unlocks: ['defense_1', 'defense_2', 'defense_3'],
    });
    expect(isBuildingTechUnlocked(state([p]), 'p1', 'defense_1')).toBe(true);
  });

  it('still refuses a building no research ever opened', () => {
    const p = player({ current_era_index: 1, legacy_building_unlocks: ['production_1'] });
    expect(isBuildingTechUnlocked(state([p]), 'p1', 'defense_1')).toBe(false);
  });

  it('accepts current-era research on its own', () => {
    const p = player({ current_era_index: 1, unlocked_techs: [MEDIEVAL_KEEP] });
    expect(isBuildingTechUnlocked(state([p]), 'p1', 'defense_1')).toBe(true);
  });

  it('ignores heritage when the feature is off (pre-feature gate behavior)', () => {
    const p = player({ current_era_index: 1, legacy_building_unlocks: ['defense_1'] });
    const off = state([p], { era_heritage_buildings_enabled: false });
    expect(isBuildingTechUnlocked(off, 'p1', 'defense_1')).toBe(false);
  });

  it('leaves ungated buildings and tech-tree-off games alone', () => {
    const p = player();
    // No era tech node unlocks a port in any classic era.
    expect(currentEraTechForBuilding(state([p]), p, 'port')).toBeUndefined();
    expect(isBuildingTechUnlocked(state([p]), 'p1', 'port')).toBe(true);
    expect(isBuildingTechUnlocked(state([p], { tech_trees_enabled: false }), 'p1', 'defense_1')).toBe(true);
  });
});

describe('buildingModernization', () => {
  const classify = (
    builtAtEra: number | undefined,
    playerEra: number,
    techs: string[],
    building: BuildingType = 'defense_1',
    settings: Partial<GameState['settings']> = {},
  ) => {
    const p = player({ current_era_index: playerEra, unlocked_techs: techs });
    const t = territory({
      buildings: [building],
      building_eras: builtAtEra == null ? undefined : { [building]: builtAtEra },
    });
    return buildingModernization(state([p], settings, { t1: t }), p, t, building);
  };

  it('treats a building raised this era as current', () => {
    expect(classify(1, 1, [])).toBe('current');
  });

  it('ages a building raised in an earlier era', () => {
    expect(classify(0, 1, [])).toBe('aged');
  });

  it('modernizes it once the era’s research covers its ladder', () => {
    expect(classify(0, 1, [MEDIEVAL_KEEP])).toBe('modernized');
    // The point of matching the LADDER rather than the exact id: a tier-3 wall
    // replaced the tier-1 beneath it, so tier-matching would leave it fixable
    // only by the era's tier-3 node — the tax this feature exists to remove.
    expect(classify(0, 1, [MEDIEVAL_KEEP], 'defense_3')).toBe('modernized');
    // Research in another line of work does not modernize walls.
    expect(classify(0, 1, ['medieval_guilds'], 'defense_3')).toBe('aged');
  });

  it('never ages a building this era cannot modernize', () => {
    // Nothing in the Medieval tree unlocks a port, so there is no research to
    // buy — aging it would be an unavoidable penalty.
    expect(classify(0, 1, [], 'port')).toBe('current');
  });

  it('treats an unstamped building as current so in-flight games are not aged', () => {
    expect(classify(undefined, 2, [])).toBe('current');
  });

  it('is inert with the feature off', () => {
    expect(classify(0, 1, [], 'defense_1', { era_heritage_buildings_enabled: false })).toBe('current');
  });
});

describe('yield math', () => {
  it('floors an aged yield at 1 so a lone tier-1 building never drops to nothing', () => {
    expect(agedYield(1)).toBe(1);  // production_1 / defense_1 / tier 1 generally
    expect(agedYield(2)).toBe(1);  // defense_2, production_2, tech_gen_1
    expect(agedYield(3)).toBe(2);  // defense_3
    expect(agedYield(4)).toBe(3);  // production_3, tech_gen_2
    expect(agedYield(7)).toBe(5);  // production_4
    expect(agedYield(0)).toBe(0);
  });

  it('pays a premium on a modernized building and leaves current ones at base', () => {
    const p = player({ current_era_index: 1, unlocked_techs: [MEDIEVAL_KEEP] });
    const old = territory({ buildings: ['defense_3'], building_eras: { defense_3: 0 } });
    const fresh = territory({ territory_id: 't2', buildings: ['defense_3'], building_eras: { defense_3: 1 } });
    const s = state([p], {}, { t1: old, t2: fresh });

    // Carried forward + this era's wall tech: restored and better than new.
    expect(effectiveBuildingYield(s, p, old, 'defense_3', 3)).toBe(4);
    // Raised this era: plain base. The premium is for continuity, so era 0 and
    // every pre-advance game keeps exactly today's numbers.
    expect(effectiveBuildingYield(s, p, fresh, 'defense_3', 3)).toBe(3);
  });

  it('degrades an aged building and no-ops on a zero base', () => {
    const p = player({ current_era_index: 1, unlocked_techs: [] });
    const t = territory({ buildings: ['defense_3'], building_eras: { defense_3: 0 } });
    const s = state([p], {}, { t1: t });
    expect(effectiveBuildingYield(s, p, t, 'defense_3', 3)).toBe(2);
    // A building that yields nothing on this stat is untouched either way.
    expect(effectiveBuildingYield(s, p, t, 'defense_3', 0)).toBe(0);
    expect(effectiveBuildingYield(s, undefined, t, 'defense_3', 3)).toBe(3);
  });
});

describe('era stamping', () => {
  it('stamps a build with the owner’s era and razes stamps on capture', () => {
    const p = player({ current_era_index: 2 });
    const t = territory({ buildings: ['production_1', 'wonder_colosseum'] });
    const s = state([p], {}, { t1: t });

    stampBuildingEra(s, p, t, 'production_1');
    stampBuildingEra(s, p, t, 'wonder_colosseum');
    expect(t.building_eras).toEqual({ production_1: 2, wonder_colosseum: 2 });

    // Capture razes every non-wonder building, so their stamps go with them.
    clearAllBuildingEras(t);
    expect(t.building_eras).toEqual({ wonder_colosseum: 2 });
  });

  it('does not stamp when the feature is off', () => {
    const p = player();
    const t = territory();
    stampBuildingEra(state([p], { era_heritage_buildings_enabled: false }), p, t, 'production_1');
    expect(t.building_eras).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  agedYield,
  buildingLineageKey,
  buildingModernization,
  effectiveYield,
  heritageEnabled,
  isHeritageOnlyUnlock,
  modernizingTech,
  type HeritageTechNode,
} from './buildingHeritage';

const TREE: HeritageTechNode[] = [
  { tech_id: 'medieval_castle_keep', name: 'Castle Keep', cost: 4, unlocks_building: 'defense_1' },
  { tech_id: 'medieval_concentric', name: 'Concentric Castle', cost: 11, unlocks_building: 'defense_3' },
  { tech_id: 'medieval_guilds', name: 'Guilds', cost: 4, unlocks_building: 'production_1' },
];

const ON = { era_advancement_enabled: true, tech_trees_enabled: true, era_heritage_buildings_enabled: true };

describe('heritageEnabled', () => {
  it('needs its own flag, era advancement and tech trees together', () => {
    expect(heritageEnabled(ON)).toBe(true);
    expect(heritageEnabled({ ...ON, tech_trees_enabled: false })).toBe(false);
    expect(heritageEnabled({ ...ON, era_advancement_enabled: false })).toBe(false);
    expect(heritageEnabled(undefined)).toBe(false);
  });
});

describe('buildingLineageKey', () => {
  it('groups a tier ladder under one key', () => {
    expect(buildingLineageKey('defense_3')).toBe('defense');
    expect(buildingLineageKey('production_1')).toBe('production');
    expect(buildingLineageKey('tech_gen_2')).toBe('tech_gen');
    expect(buildingLineageKey('naval_base')).toBe('naval');
    expect(buildingLineageKey('port')).toBe('naval');
    expect(buildingLineageKey('launch_pad')).toBe('launch_pad');
  });
});

describe('buildingModernization', () => {
  const player = (era: number, techs: string[] = []) => ({
    current_era_index: era, unlocked_techs: techs,
  });
  const territory = (builtAt?: number) =>
    (builtAt == null ? {} : { building_eras: { defense_3: builtAt } });

  it('matches the server: current, aged, then modernized by any tech on the ladder', () => {
    expect(buildingModernization(ON, player(1), territory(1), 'defense_3', TREE)).toBe('current');
    expect(buildingModernization(ON, player(1), territory(0), 'defense_3', TREE)).toBe('aged');
    // The cheap tier-1 node modernizes a carried tier-3 wall — the whole point
    // of matching the ladder rather than the exact building id.
    expect(buildingModernization(ON, player(1, ['medieval_castle_keep']), territory(0), 'defense_3', TREE))
      .toBe('modernized');
    // Another line of work does not.
    expect(buildingModernization(ON, player(1, ['medieval_guilds']), territory(0), 'defense_3', TREE))
      .toBe('aged');
  });

  it('treats unstamped buildings and a disabled feature as current', () => {
    expect(buildingModernization(ON, player(2), territory(), 'defense_3', TREE)).toBe('current');
    expect(buildingModernization({ ...ON, era_heritage_buildings_enabled: false }, player(1), territory(0), 'defense_3', TREE))
      .toBe('current');
  });

  it('never ages a building this era has no research for', () => {
    const t = { building_eras: { port: 0 } };
    expect(buildingModernization(ON, player(1), t, 'port', TREE)).toBe('current');
  });
});

describe('yields', () => {
  it('mirrors the server floor and premium', () => {
    expect(agedYield(1)).toBe(1);
    expect(agedYield(3)).toBe(2);
    expect(agedYield(7)).toBe(5);
    expect(effectiveYield('aged', 3)).toBe(2);
    expect(effectiveYield('modernized', 3)).toBe(4);
    expect(effectiveYield('current', 3)).toBe(3);
    expect(effectiveYield('modernized', 0)).toBe(0);
  });
});

describe('modernizingTech', () => {
  it('names the cheapest research that would lift an aged building', () => {
    expect(modernizingTech(TREE, { unlocked_techs: [] }, 'defense_3')?.tech_id)
      .toBe('medieval_castle_keep');
  });

  it('returns nothing once the ladder is already covered', () => {
    expect(modernizingTech(TREE, { unlocked_techs: ['medieval_concentric'] }, 'defense_3'))
      .toBeUndefined();
  });
});

describe('isHeritageOnlyUnlock', () => {
  it('flags a building offered purely by inherited right', () => {
    const p = { current_era_index: 1, unlocked_techs: [], legacy_building_unlocks: ['defense_1'] };
    expect(isHeritageOnlyUnlock(ON, p, 'defense_1', TREE)).toBe(true);
  });

  it('does not flag one the player researched this era, or one nothing gates', () => {
    const researched = { current_era_index: 1, unlocked_techs: ['medieval_castle_keep'], legacy_building_unlocks: ['defense_1'] };
    expect(isHeritageOnlyUnlock(ON, researched, 'defense_1', TREE)).toBe(false);
    const p = { current_era_index: 1, unlocked_techs: [], legacy_building_unlocks: ['port'] };
    expect(isHeritageOnlyUnlock(ON, p, 'port', TREE)).toBe(false);
  });
});

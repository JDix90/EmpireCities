import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { getEraTechTree } from '../eras';
import { selectAiTechResearch, selectAiBuildingPlacement } from './aiBot';

/**
 * Regression coverage for the "bots frozen in Ancient" steamroll bug: easy/medium
 * bots must research + build toward the advancement gate in era-advancement games
 * (they were no-ops before), and research must be gate-directed (fill tier-1, then
 * tier-2) rather than cheapest-first.
 */

const ANCIENT = getEraTechTree('ancient');
const tier1Ids = ANCIENT.filter((n) => n.tier === 1).map((n) => n.tech_id);
const tier2Ids = ANCIENT.filter((n) => n.tier === 2).map((n) => n.tech_id);

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'ai1',
    player_index: 0,
    is_ai: true,
    is_eliminated: false,
    current_era_index: 0,
    unlocked_techs: [],
    tech_points: 100,
    special_resource: 100,
    ...overrides,
  } as PlayerState;
}

function state(settings: Partial<GameState['settings']>, players: PlayerState[], territories: Record<string, TerritoryState>): GameState {
  return {
    era: 'ancient',
    players,
    territories,
    settings: { era_advancement_min_tier1_techs: 3, era_advancement_min_tier2_techs: 1, era_advancement_min_buildings: 1, ...settings },
  } as GameState;
}

const owned = (): Record<string, TerritoryState> => ({
  t1: { territory_id: 't1', owner_id: 'ai1', unit_count: 10, unit_type: 'infantry', buildings: [] },
  t2: { territory_id: 't2', owner_id: 'ai1', unit_count: 5, unit_type: 'infantry', buildings: [] },
});

describe('selectAiTechResearch — era-advancement gate-directed', () => {
  it('easy researches a tier-1 tech in era-advancement games (was a no-op → frozen)', () => {
    const s = state({ tech_trees_enabled: true, era_advancement_enabled: true }, [player()], owned());
    const tech = selectAiTechResearch(s, 'ai1', 'easy');
    expect(tech).not.toBeNull();
    expect(tier1Ids).toContain(tech);
  });

  it('easy stays a no-op in a normal (non-advancement) game', () => {
    const s = state({ tech_trees_enabled: true, era_advancement_enabled: false }, [player()], owned());
    expect(selectAiTechResearch(s, 'ai1', 'easy')).toBeNull();
  });

  it('prioritizes a tier-2 tech once the tier-1 requirement is met', () => {
    // Unlock the 3 tier-1 techs the gate needs; the prerequisite of a tier-2 is among them.
    const unlocked = tier1Ids.slice(0, 3);
    // Find a tier-2 whose prerequisite we have unlocked.
    const reachableTier2 = ANCIENT.find((n) => n.tier === 2 && (!n.prerequisite || unlocked.includes(n.prerequisite)));
    const withPrereq = reachableTier2?.prerequisite && !unlocked.includes(reachableTier2.prerequisite)
      ? [...unlocked, reachableTier2.prerequisite]
      : unlocked;
    const s = state({ tech_trees_enabled: true, era_advancement_enabled: true }, [player({ unlocked_techs: withPrereq })], owned());
    const tech = selectAiTechResearch(s, 'ai1', 'medium');
    expect(tier2Ids).toContain(tech);
  });
});

describe('selectAiBuildingPlacement — era-advancement un-freeze', () => {
  it('easy builds toward the gate in era-advancement games (was a no-op)', () => {
    const s = state({ economy_enabled: true, era_advancement_enabled: true }, [player()], owned());
    const build = selectAiBuildingPlacement(s, { connections: [] } as never, 'ai1', 'easy');
    expect(build).not.toBeNull();
  });

  it('easy stays a no-op in a normal game, and once the building gate is met', () => {
    const normal = state({ economy_enabled: true, era_advancement_enabled: false }, [player()], owned());
    expect(selectAiBuildingPlacement(normal, { connections: [] } as never, 'ai1', 'easy')).toBeNull();

    const built = owned();
    built.t1.buildings = ['production_1'];
    const met = state({ economy_enabled: true, era_advancement_enabled: true }, [player()], built);
    expect(selectAiBuildingPlacement(met, { connections: [] } as never, 'ai1', 'easy')).toBeNull();
  });
});

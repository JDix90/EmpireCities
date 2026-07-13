import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { selectAiTechResearch } from './aiBot';

/**
 * Galactic Age AI research rules:
 * - Galaxy has no era advancement, so the old "easy never researches in normal
 *   games" gate world-locked every non-Helion easy bot forever (observed live:
 *   0 techs after 10+ turns). Easy now buys the Hyperspace Chart — and only
 *   the chart.
 * - Bots whose lane access is already granted (Helion faction, Hyperlane
 *   Anchor, or the chart itself) must not waste TP re-buying the chart via the
 *   generic cheapest/score paths (observed live: Helion medium bots burning
 *   5 TP on it).
 */

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

function galaxyState(players: PlayerState[], territories: Record<string, TerritoryState>): GameState {
  return {
    era: 'galaxy_age',
    players,
    territories,
    settings: { tech_trees_enabled: true, era_advancement_enabled: false },
  } as GameState;
}

const home = (buildings: string[] = []): Record<string, TerritoryState> => ({
  rust_a: { territory_id: 'rust_a', owner_id: 'ai1', unit_count: 10, unit_type: 'infantry', world_id: 'rust', buildings },
  rust_b: { territory_id: 'rust_b', owner_id: 'ai1', unit_count: 5, unit_type: 'infantry', world_id: 'rust', buildings: [] },
});

describe('selectAiTechResearch — Galactic Age', () => {
  it('easy (non-Helion) researches the Hyperspace Chart instead of being world-locked', () => {
    const s = galaxyState([player({ faction_id: 'forge_syndicate' })], home());
    expect(selectAiTechResearch(s, 'ai1', 'easy')).toBe('ga_hyperspace_chart');
  });

  it('easy researches nothing further once the chart is unlocked', () => {
    const s = galaxyState([player({ faction_id: 'forge_syndicate', unlocked_techs: ['ga_hyperspace_chart'] })], home());
    expect(selectAiTechResearch(s, 'ai1', 'easy')).toBeNull();
  });

  it('easy Helion stays fully passive (its lanes are already open)', () => {
    const s = galaxyState([player({ faction_id: 'helion_navigators' })], home());
    expect(selectAiTechResearch(s, 'ai1', 'easy')).toBeNull();
  });

  it('medium Helion never buys the chart via the cheapest-first path', () => {
    const s = galaxyState([player({ faction_id: 'helion_navigators' })], home());
    const tech = selectAiTechResearch(s, 'ai1', 'medium');
    expect(tech).not.toBeNull();
    expect(tech).not.toBe('ga_hyperspace_chart');
  });

  it('a bot holding the Hyperlane Anchor never buys the chart', () => {
    const s = galaxyState(
      [player({ faction_id: 'forge_syndicate' })],
      home(['wonder_hyperlane_anchor']),
    );
    const tech = selectAiTechResearch(s, 'ai1', 'medium');
    expect(tech).not.toBeNull();
    expect(tech).not.toBe('ga_hyperspace_chart');
  });

  it('medium non-Helion without access still front-runs the chart (hook regression)', () => {
    const s = galaxyState([player({ faction_id: 'forge_syndicate' })], home());
    expect(selectAiTechResearch(s, 'ai1', 'medium')).toBe('ga_hyperspace_chart');
  });
});

import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { evaluateEraAdvancementReadiness } from './eraAdvancementReadiness';

const MILESTONE_TECHS = [
  'ancient_iron_weapons',
  'ancient_stone_walls',
  'ancient_granaries',
  'ancient_siege_engines',
];

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'human',
    player_index: 0,
    username: 'Human',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 2,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    unlocked_techs: MILESTONE_TECHS,
    current_era_index: 0,
    ...overrides,
  } as PlayerState;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'era_ancient',
    phase: 'draft',
    turn_number: 4,
    current_player_index: 0,
    players: [basePlayer()],
    territories: {
      t1: {
        territory_id: 't1',
        owner_id: 'human',
        unit_count: 5,
        unit_type: 'infantry',
        buildings: ['production_1'],
      },
    },
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      era_advancement_enabled: true,
      era_advancement_tech_gate_mode: 'milestone',
      era_advancement_min_tier1_techs: 3,
      era_advancement_min_tier2_techs: 1,
      era_advancement_min_buildings: 1,
    },
    ...overrides,
  } as GameState;
}

describe('evaluateEraAdvancementReadiness', () => {
  it('passes milestone gate when tier1, tier2, and buildings are met', () => {
    const result = evaluateEraAdvancementReadiness(baseState(), 'human');
    expect(result.met).toBe(true);
    expect(result.mode).toBe('milestone');
    expect(result.tier1?.met).toBe(true);
    expect(result.tier2?.met).toBe(true);
    expect(result.buildings?.met).toBe(true);
  });

  it('fails when tier-1 count is short', () => {
    const state = baseState({
      players: [basePlayer({ unlocked_techs: ['ancient_iron_weapons', 'ancient_siege_engines'] })],
    });
    const result = evaluateEraAdvancementReadiness(state, 'human');
    expect(result.met).toBe(false);
    expect(result.error).toContain('tier-1');
  });

  it('fails when tier-2 count is short', () => {
    const state = baseState({
      players: [basePlayer({
        unlocked_techs: ['ancient_iron_weapons', 'ancient_stone_walls', 'ancient_granaries'],
      })],
    });
    const result = evaluateEraAdvancementReadiness(state, 'human');
    expect(result.met).toBe(false);
    expect(result.error).toContain('tier-2');
  });

  it('fails when no buildings are built', () => {
    const state = baseState({
      territories: {
        t1: { territory_id: 't1', owner_id: 'human', unit_count: 5, unit_type: 'infantry', buildings: [] },
      },
    });
    const result = evaluateEraAdvancementReadiness(state, 'human');
    expect(result.met).toBe(false);
    expect(result.error).toContain('building');
  });

  it('uses percent mode when configured', () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_tech_gate_mode: 'percent',
        era_advancement_tech_gate_pct: 0.33,
      },
      players: [basePlayer({ unlocked_techs: ['ancient_iron_weapons', 'ancient_stone_walls', 'ancient_granaries', 'ancient_roads'] })],
    });
    const result = evaluateEraAdvancementReadiness(state, 'human');
    expect(result.mode).toBe('percent');
    expect(result.met).toBe(true);
    expect(result.percent).toEqual({ unlocked: 4, required: 4 });
  });

  it('skips gate when tech trees are disabled', () => {
    const state = baseState({
      settings: { ...baseState().settings, tech_trees_enabled: false },
    });
    expect(evaluateEraAdvancementReadiness(state, 'human').met).toBe(true);
  });
});

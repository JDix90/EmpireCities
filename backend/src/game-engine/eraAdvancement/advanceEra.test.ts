import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { canAdvanceEra, computeAdvanceCost, executeAdvanceEra } from './advanceEra';

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'human',
    player_index: 0,
    username: 'Human',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 3,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    special_resource: 100,
    last_turn_production_income: 10,
    unlocked_techs: [
      'ancient_iron_weapons',
      'ancient_stone_walls',
      'ancient_granaries',
    ],
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
      t1: { territory_id: 't1', owner_id: 'human', unit_count: 10, unit_type: 'infantry', stability: 80, population: 5 },
      t2: { territory_id: 't2', owner_id: 'human', unit_count: 6, unit_type: 'infantry', stability: 70, population: 4 },
      t3: { territory_id: 't3', owner_id: 'human', unit_count: 4, unit_type: 'infantry', stability: 60, population: 3 },
    },
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      era_advancement_enabled: true,
      era_advancement_cost_mult: 2.0,
      era_advancement_cost_escalation: 1.5,
      era_advancement_stability_gate: 60,
      era_advancement_tech_gate_pct: 0.25,
      era_advancement_conversion_ratio: 0.7,
      era_advancement_max_era_index: 1,
    },
    ...overrides,
  } as GameState;
}

describe('computeAdvanceCost', () => {
  it('scales by income, multiplier, and era index', () => {
    const state = baseState();
    const player = basePlayer({ last_turn_production_income: 10, current_era_index: 0 });
    expect(computeAdvanceCost(state, player)).toBe(20);

    player.current_era_index = 1;
    expect(computeAdvanceCost(state, player)).toBe(30);
  });
});

describe('canAdvanceEra', () => {
  it('passes when all gates are met', () => {
    const result = canAdvanceEra(baseState(), 'human');
    expect(result.canAdvance).toBe(true);
    expect(result.cost).toBe(20);
  });

  it('rejects insufficient gold', () => {
    const state = baseState({
      players: [basePlayer({ special_resource: 5 })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('rejects low stability when enabled', () => {
    const state = baseState({
      territories: {
        t1: { territory_id: 't1', owner_id: 'human', unit_count: 5, unit_type: 'infantry', stability: 20, population: 5 },
      },
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('rejects when tech gate not met', () => {
    const state = baseState({
      players: [basePlayer({ unlocked_techs: ['ancient_iron_weapons'] })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });
});

describe('executeAdvanceEra', () => {
  it('deducts gold, converts units, advances era, and grants signature charge', () => {
    const state = baseState();
    const result = executeAdvanceEra(state, 'human');
    expect(result.success).toBe(true);

    const player = state.players[0]!;
    expect(player.special_resource).toBe(80);
    expect(player.current_era_index).toBe(1);
    expect(player.era_transition_turns_remaining).toBe(1);
    expect(player.medieval_signature_charges).toBe(1);
    expect(player.unlocked_techs).toEqual([]);

    const totalUnits = Object.values(state.territories).reduce((s, t) => s + t.unit_count, 0);
    expect(totalUnits).toBe(14);
  });
});

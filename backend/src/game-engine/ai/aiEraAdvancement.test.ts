import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  countBorderThreat,
  evaluateAiEraAdvancement,
  maxOpponentEraIndex,
  vulnerabilityAttackBonus,
} from './aiEraAdvancement';

const MILESTONE_TECHS = [
  'ancient_iron_weapons',
  'ancient_stone_walls',
  'ancient_granaries',
  'ancient_siege_engines',
];

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'ai1',
    player_index: 0,
    username: 'AI',
    color: '#fff',
    is_ai: true,
    is_eliminated: false,
    territory_count: 3,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    special_resource: 200,
    last_turn_production_income: 15,
    unlocked_techs: MILESTONE_TECHS,
    current_era_index: 0,
    ai_difficulty: 'medium',
    ...overrides,
  } as PlayerState;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'era_ancient',
    phase: 'draft',
    turn_number: 6,
    current_player_index: 0,
    players: [
      basePlayer(),
      basePlayer({
        player_id: 'human',
        player_index: 1,
        is_ai: false,
        username: 'Human',
        current_era_index: 1,
      }),
    ],
    territories: {
      t1: { territory_id: 't1', owner_id: 'ai1', unit_count: 12, unit_type: 'infantry', stability: 80, population: 5, buildings: ['production_1'] },
      t2: { territory_id: 't2', owner_id: 'ai1', unit_count: 8, unit_type: 'infantry', stability: 75, population: 4 },
      t3: { territory_id: 't3', owner_id: 'human', unit_count: 3, unit_type: 'infantry', stability: 70, population: 3 },
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
      era_advancement_tech_gate_pct: 0.5,
      era_advancement_stability_gate: 60,
      era_advancement_cost_mult: 2.0,
    },
    ...overrides,
  } as GameState;
}

const map: GameMap = {
  map_id: 'era_ancient',
  name: 'Ancient',
  territories: [],
  connections: [
    { from: 't1', to: 't3', type: 'land' },
    { from: 't2', to: 't3', type: 'land' },
  ],
  regions: [],
};

describe('aiEraAdvancement helpers', () => {
  it('counts border threat from adjacent enemy units', () => {
    // t3 (3 units) borders both t1 and t2 — exposure counted per border edge.
    expect(countBorderThreat(baseState(), map, 'ai1')).toBe(6);
  });

  it('reads max opponent era index', () => {
    expect(maxOpponentEraIndex(baseState(), 'ai1')).toBe(1);
  });

  it('returns vulnerability attack bonus for hard difficulty', () => {
    const state = baseState({
      players: [
        basePlayer(),
        basePlayer({
          player_id: 'human',
          player_index: 1,
          is_ai: false,
          era_transition_turns_remaining: 1,
        }),
      ],
    });
    expect(vulnerabilityAttackBonus(state, 'human', 'hard')).toBe(4);
    expect(vulnerabilityAttackBonus(state, 'human', 'easy')).toBe(1);
  });
});

describe('evaluateAiEraAdvancement', () => {
  it('never advances for tutorial difficulty', () => {
    const result = evaluateAiEraAdvancement(baseState(), map, 'ai1', 'tutorial');
    expect(result.shouldAdvance).toBe(false);
  });

  it('stays when gates fail', () => {
    const state = baseState({
      players: [basePlayer({ special_resource: 1 })],
    });
    const result = evaluateAiEraAdvancement(state, map, 'ai1', 'medium');
    expect(result.gatePassed).toBe(false);
    expect(result.shouldAdvance).toBe(false);
  });

  it('advances when behind opponents, secure, and gates pass (hard)', () => {
    const result = evaluateAiEraAdvancement(baseState(), map, 'ai1', 'hard');
    expect(result.gatePassed).toBe(true);
    expect(result.shouldAdvance).toBe(true);
  });

  it('stays when border threat is high', () => {
    const state = baseState({
      territories: {
        t1: { territory_id: 't1', owner_id: 'ai1', unit_count: 5, unit_type: 'infantry', stability: 80, population: 5 },
        t3: { territory_id: 't3', owner_id: 'human', unit_count: 20, unit_type: 'infantry', stability: 70, population: 3 },
      },
    });
    const result = evaluateAiEraAdvancement(state, map, 'ai1', 'medium');
    expect(result.shouldAdvance).toBe(false);
  });
});

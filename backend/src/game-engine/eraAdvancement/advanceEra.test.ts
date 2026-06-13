import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { buildAdvanceEraClientPreview, canAdvanceEra, computeAdvanceCost, executeAdvanceEra } from './advanceEra';
import { consumeSignatureAttackBonus } from './signatures';

const MILESTONE_TECHS = [
  'ancient_iron_weapons',
  'ancient_stone_walls',
  'ancient_granaries',
  'ancient_siege_engines',
];

const SIX_ANCIENT_TECHS = [
  ...MILESTONE_TECHS,
  'ancient_fortified_camps',
  'ancient_trade_routes',
];

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
    unlocked_techs: MILESTONE_TECHS,
    current_era_index: 0,
    ...overrides,
  } as PlayerState;
}

function baseTerritories() {
  return {
    t1: {
      territory_id: 't1',
      owner_id: 'human',
      unit_count: 10,
      unit_type: 'infantry',
      stability: 80,
      population: 5,
      buildings: ['production_1'],
    },
    t2: {
      territory_id: 't2',
      owner_id: 'human',
      unit_count: 6,
      unit_type: 'infantry',
      stability: 70,
      population: 4,
    },
    t3: {
      territory_id: 't3',
      owner_id: 'human',
      unit_count: 4,
      unit_type: 'infantry',
      stability: 60,
      population: 3,
    },
  };
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
    territories: baseTerritories(),
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
      era_advancement_tech_gate_mode: 'milestone',
      era_advancement_min_tier1_techs: 3,
      era_advancement_min_tier2_techs: 1,
      era_advancement_min_buildings: 1,
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

  it('rejects when mode is disabled', () => {
    const state = baseState({
      settings: { ...baseState().settings, era_advancement_enabled: false },
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
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
        t1: { territory_id: 't1', owner_id: 'human', unit_count: 5, unit_type: 'infantry', stability: 20, population: 5, buildings: ['production_1'] },
      },
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('rejects when milestone tech gate not met (need 3 tier-1 + 1 tier-2)', () => {
    const state = baseState({
      players: [basePlayer({ unlocked_techs: ['ancient_iron_weapons'] })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('rejects when milestone building gate not met', () => {
    const state = baseState({
      territories: {
        t1: { territory_id: 't1', owner_id: 'human', unit_count: 5, unit_type: 'infantry', stability: 80, population: 5 },
      },
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('passes milestone gate with 3 tier-1, 1 tier-2, and a building', () => {
    const state = baseState({
      players: [basePlayer({ unlocked_techs: MILESTONE_TECHS })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(true);
  });

  it('uses percent mode when configured', () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_tech_gate_mode: 'percent',
        era_advancement_tech_gate_pct: 0.5,
      },
      players: [basePlayer({ unlocked_techs: SIX_ANCIENT_TECHS })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(true);

    const failState = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_tech_gate_mode: 'percent',
        era_advancement_tech_gate_pct: 0.5,
      },
      players: [basePlayer({ unlocked_techs: ['ancient_iron_weapons'] })],
    });
    expect(canAdvanceEra(failState, 'human').canAdvance).toBe(false);
  });

  it('rejects eliminated players', () => {
    const state = baseState({
      players: [basePlayer({ is_eliminated: true })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('rejects when already at max era', () => {
    const state = baseState({
      players: [basePlayer({ current_era_index: 1 })],
    });
    expect(canAdvanceEra(state, 'human').canAdvance).toBe(false);
  });

  it('allows AI players when gates pass (Stage 2 parity)', () => {
    const territories = Object.fromEntries(
      Object.entries(baseTerritories()).map(([id, t]) => [id, { ...t, owner_id: 'ai1' }]),
    );
    const state = baseState({
      players: [basePlayer({ is_ai: true, player_id: 'ai1' })],
      territories,
    });
    expect(canAdvanceEra(state, 'ai1').canAdvance).toBe(true);
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
    expect(player.era_signature_charges?.levy_of_knights).toBe(1);
    expect(player.unlocked_techs).toEqual([]);

    const totalUnits = Object.values(state.territories).reduce((s, t) => s + t.unit_count, 0);
    expect(totalUnits).toBe(14);
  });

  it('captures tech echo bonuses from departing era', () => {
    const state = baseState();
    executeAdvanceEra(state, 'human');
    const player = state.players[0]!;
    expect(player.era_advancement_tech_echo).toBeDefined();
    expect(Object.keys(player.era_advancement_tech_echo ?? {}).length).toBeGreaterThan(0);
  });

  it('sets era_advanced_this_turn when advancing during attack phase', () => {
    const state = baseState({ phase: 'attack' });
    executeAdvanceEra(state, 'human');
    expect(state.players[0]!.era_advanced_this_turn).toBe(true);
  });

  it('consumes the signature charge on first bonus attack only (socket parity)', () => {
    const player = basePlayer({ era_signature_charges: { levy_of_knights: 1 } });
    expect(consumeSignatureAttackBonus(player)).toBe(1);
    expect(player.era_signature_charges?.levy_of_knights).toBe(0);
    expect(consumeSignatureAttackBonus(player)).toBe(0);
  });
});

describe('buildAdvanceEraClientPreview', () => {
  it('returns the full viewer payload for an advance-ready player', () => {
    const preview = buildAdvanceEraClientPreview(baseState(), 'human');
    expect(preview).toEqual({
      cost: 20,
      can_advance: true,
      error: undefined,
      current_era_index: 0,
      max_era_index: 1,
      current_era_id: 'ancient',
      next_era_id: 'medieval',
      stability: expect.any(Number),
      stability_gate: 60,
      gate_mode: 'milestone',
      readiness: expect.objectContaining({
        met: true,
        mode: 'milestone',
        tier1: expect.objectContaining({ met: true, current: 3, required: 3 }),
        tier2: expect.objectContaining({ met: true, current: 1, required: 1 }),
        buildings: expect.objectContaining({ met: true, current: 1, required: 1 }),
      }),
    });
  });

  it('reports blocked gates for a player short on gold', () => {
    const state = baseState({ players: [basePlayer({ special_resource: 5 })] });
    const preview = buildAdvanceEraClientPreview(state, 'human');
    expect(preview?.can_advance).toBe(false);
    expect(preview?.error).toMatch(/gold/i);
    expect(preview?.cost).toBe(20);
  });

  it('returns null when era advancement is disabled or the player is unknown', () => {
    const disabled = baseState();
    disabled.settings.era_advancement_enabled = false;
    expect(buildAdvanceEraClientPreview(disabled, 'human')).toBeNull();
    expect(buildAdvanceEraClientPreview(baseState(), 'ghost')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import {
  getFortifyMoveLimit,
  getInfluenceUnitCost,
  getPrecisionStrikeMinUnits,
  getUnlockedAbilityIds,
  playerHasUnlockedAbility,
  attackerIgnoresDefenseBuilding,
} from './techAbilities';

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'coldwar',
    map_id: 'era_coldwar',
    phase: 'attack',
    turn_number: 1,
    current_player_index: 0,
    players: [{
      player_id: 'p1',
      player_index: 0,
      username: 'Test',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 5,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: [],
      tech_points: 0,
    }],
    territories: {},
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      tech_trees_enabled: true,
      factions_enabled: false,
      economy_enabled: true,
      events_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
    },
    ...overrides,
  } as GameState;
}

describe('techAbilities', () => {
  it('detects nuclear_strike when cw_icbm is researched', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['cw_icbm'];
    expect(playerHasUnlockedAbility(state, 'p1', 'nuclear_strike')).toBe(true);
  });

  it('proxy_funding reduces influence cost to 2', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['cw_proxy_wars'];
    expect(getInfluenceUnitCost(state, 'p1')).toBe(2);
  });

  it('defaults influence cost to 3 without proxy_funding', () => {
    const state = baseState();
    expect(getInfluenceUnitCost(state, 'p1')).toBe(3);
  });

  it('motorized_logistics raises fortify limit to 3 in WW2', () => {
    const state = baseState({ era: 'ww2', era_modifiers: { wartime_logistics: true } });
    state.players[0]!.unlocked_techs = ['ww2_motorization'];
    expect(getFortifyMoveLimit(state, 'p1')).toBe(3);
  });

  it('special_ops lowers precision strike threshold to 2 units', () => {
    const state = baseState({ era: 'modern', era_modifiers: { precision_strike: true } });
    state.players[0]!.unlocked_techs = ['mod_special_forces'];
    expect(getPrecisionStrikeMinUnits(state, 'p1')).toBe(2);
  });

  it('siege_attack ignores defense buildings passively', () => {
    const state = baseState({ era: 'ancient' });
    state.players[0]!.unlocked_techs = ['ancient_siege_engines'];
    expect(attackerIgnoresDefenseBuilding(state, 'p1')).toBe(true);
  });

  it('returns empty ability set when tech trees disabled', () => {
    const state = baseState();
    state.settings.tech_trees_enabled = false;
    state.players[0]!.unlocked_techs = ['cw_icbm'];
    expect(getUnlockedAbilityIds(state, state.players[0]!).size).toBe(0);
  });
});

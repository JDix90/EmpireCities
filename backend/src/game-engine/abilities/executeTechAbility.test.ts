import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { executeTechAbility } from './executeTechAbility';

function baseState(): GameState {
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
      territory_count: 2,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: ['cw_icbm'],
    }],
    territories: {
      t1: { territory_id: 't1', owner_id: 'p1', unit_count: 5, buildings: [], naval_units: 0 },
      t2: { territory_id: 't2', owner_id: 'p2', unit_count: 4, buildings: [], naval_units: 0 },
    },
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
  } as GameState;
}

const map = {
  map_id: 'era_coldwar',
  name: 'Cold War',
  territories: [],
  connections: [{ from: 't1', to: 't2', type: 'land' as const }],
  regions: [],
};

describe('executeTechAbility', () => {
  it('nuclear_strike reduces enemy units by 2', () => {
    const state = baseState();
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'nuclear_strike',
      territoryId: 't2',
    });
    expect(result.success).toBe(true);
    expect(state.territories.t2!.unit_count).toBe(2);
  });

  it('rejects nuclear_strike on own territory', () => {
    const state = baseState();
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'nuclear_strike',
      territoryId: 't1',
    });
    expect(result.success).toBe(false);
  });

  it('air_strike sets pending pre-attack damage', () => {
    const state = baseState();
    state.players[0]!.unlocked_techs = ['ww2_air_support'];
    const result = executeTechAbility({
      state,
      map,
      playerId: 'p1',
      abilityId: 'air_strike',
    });
    expect(result.success).toBe(true);
    expect(state.players[0]!.pending_pre_attack_damage).toBe(1);
  });
});

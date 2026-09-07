import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { getPlayerTechPointIncome } from './techManager';

function makeState(factionsEnabled: boolean, factionId = 'corpo_enclave'): GameState {
  return {
    game_id: 'g1',
    era: 'space_age',
    map_id: 'era_space_age',
    phase: 'draft',
    turn_number: 1,
    current_player_index: 0,
    players: [{
      player_id: 'p1',
      player_index: 0,
      username: 'P1',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 1,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: null,
      unlocked_techs: [],
      tech_points: 0,
      faction_id: factionId,
    }],
    territories: {},
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      tech_trees_enabled: true,
      factions_enabled: factionsEnabled,
      economy_enabled: true,
    },
  } as GameState;
}

describe('getPlayerTechPointIncome faction income', () => {
  it('adds the faction tech_point_income when factions are enabled', () => {
    expect(getPlayerTechPointIncome(makeState(true), 'p1')).toBe(4);
  });

  it('ignores the faction tech_point_income when factions are disabled', () => {
    expect(getPlayerTechPointIncome(makeState(false), 'p1')).toBe(0);
  });

  it('adds nothing for a faction without tech_point_income', () => {
    expect(getPlayerTechPointIncome(makeState(true, 'terran_federation'), 'p1')).toBe(0);
  });

  it('stacks faction income on top of researched tech income', () => {
    const state = makeState(true);
    state.players[0]!.unlocked_techs = ['sa_ai_command']; // +2 TP/turn
    expect(getPlayerTechPointIncome(state, 'p1')).toBe(6);
  });
});

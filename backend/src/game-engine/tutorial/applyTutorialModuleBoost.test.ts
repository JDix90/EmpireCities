import { describe, expect, it } from 'vitest';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import type { GameState } from '../../types';

function minimalState(overrides: Partial<GameState['settings']> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ww2',
    map_id: 'era_ww2',
    phase: 'draft',
    current_player_index: 0,
    turn_number: 1,
    players: [
      {
        player_id: 'human',
        player_index: 0,
        username: 'Human',
        color: '#fff',
        is_ai: false,
        is_eliminated: false,
        territory_count: 1,
        cards: [],
        capital_territory_id: null,
        secret_mission: null,
        tech_points: 0,
        unlocked_techs: [],
        ability_uses: {},
        mmr: 1000,
      },
      {
        player_id: 'ai_1',
        player_index: 1,
        username: 'AI',
        color: '#000',
        is_ai: true,
        is_eliminated: false,
        territory_count: 1,
        cards: [],
        capital_territory_id: null,
        secret_mission: null,
        mmr: 1000,
      },
    ],
    territories: {},
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: false,
      diplomacy_enabled: false,
      tutorial: true,
      tech_trees_enabled: true,
      tutorial_grant_tech_points: 8,
      ...overrides,
    },
    draft_units_remaining: 3,
    draft_placements_this_turn: {},
    turn_started_at: Date.now(),
    win_probability_history: [],
    fortify_moves_used: 0,
    influence_cooldown_remaining: 0,
    blitzkrieg_attacked: false,
  };
}

describe('applyTutorialModuleBoost', () => {
  it('grants bonus tech points to the human player', () => {
    const state = minimalState();
    applyTutorialModuleBoost(state);
    expect(state.players[0].tech_points).toBe(8);
  });

  it('no-ops when tutorial flag is off', () => {
    const state = minimalState({ tutorial: false });
    applyTutorialModuleBoost(state);
    expect(state.players[0].tech_points).toBe(0);
  });

  it('no-ops when tech_trees_enabled is false', () => {
    const state = minimalState({ tech_trees_enabled: false });
    applyTutorialModuleBoost(state);
    expect(state.players[0].tech_points).toBe(0);
  });

  it('no-ops when tutorial_grant_tech_points is 0', () => {
    const state = minimalState({ tutorial_grant_tech_points: 0 });
    applyTutorialModuleBoost(state);
    expect(state.players[0].tech_points).toBe(0);
  });

  it('does not grant to AI player', () => {
    const state = minimalState();
    applyTutorialModuleBoost(state);
    expect((state.players[1] as { tech_points?: number }).tech_points).toBeUndefined();
  });

  it('faction_ability lesson: human player should be china_ww2', () => {
    // This is a contract test: the tutorial/start endpoint sets faction_id = 'china_ww2'.
    // Here we verify the boost function does not interfere with faction-only modules
    // (no tech grant when tech_trees_enabled=false, factions_enabled=true).
    const state = minimalState({
      tutorial_lesson_module: 'faction_ability',
      factions_enabled: true,
      tech_trees_enabled: false,
      tutorial_grant_tech_points: undefined,
    });
    applyTutorialModuleBoost(state);
    expect(state.players[0].tech_points).toBe(0);
  });
});

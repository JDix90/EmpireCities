import { describe, it, expect } from 'vitest';
import { applyTutorialSettingsLab } from './applyTutorialSettingsLab';
import type { GameState } from '../../types';

function makeState(overrides: Partial<GameState> = {}): GameState {
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
        player_color: '#3498db',
        is_ai: false,
        territory_count: 5,
        cards: [],
        capital_territory_id: null,
        secret_mission: null,
      },
      {
        player_id: 'ai',
        player_index: 1,
        player_color: '#e74c3c',
        is_ai: true,
        territory_count: 5,
        cards: [],
        capital_territory_id: null,
        secret_mission: null,
      },
    ],
    territories: {
      t1: { territory_id: 't1', owner_id: 'human', unit_count: 3, unit_type: 'infantry' },
      t2: { territory_id: 't2', owner_id: 'ai', unit_count: 3, unit_type: 'infantry' },
    },
    card_deck: [],
    card_set_redemption_count: 0,
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: false,
      diplomacy_enabled: false,
      tutorial: true,
      tutorial_lesson_module: 'advanced_settings',
    },
    draft_units_remaining: 6,
    draft_placements_this_turn: {},
    turn_started_at: Date.now(),
    win_probability_history: [],
    fortify_moves_used: 0,
    influence_cooldown_remaining: 0,
    blitzkrieg_attacked: false,
    ...overrides,
  };
}

describe('applyTutorialSettingsLab', () => {
  it('returns empty when not an advanced-settings tutorial', () => {
    const state = makeState({
      settings: {
        ...makeState().settings,
        tutorial_lesson_module: 'core',
      },
    });
    expect(applyTutorialSettingsLab(state, { fog_of_war: true })).toEqual([]);
    expect(state.settings.fog_of_war).toBe(false);
  });

  it('enables fog of war and tech tree with bonus TP', () => {
    const state = makeState();
    const labels = applyTutorialSettingsLab(state, {
      fog_of_war: true,
      tech_trees_enabled: true,
    });
    expect(labels).toContain('Fog of War');
    expect(labels).toContain('Technology Tree');
    expect(state.settings.fog_of_war).toBe(true);
    expect(state.settings.tech_trees_enabled).toBe(true);
    expect(state.players[0].tech_points).toBe(8);
    expect(state.settings.tutorial_settings_lab_applied).toBe(true);
  });

  it('assigns demo factions and starting production when enabled', () => {
    const state = makeState();
    const labels = applyTutorialSettingsLab(state, {
      factions_enabled: true,
      economy_enabled: true,
    });
    expect(labels).toContain('Factions');
    expect(labels).toContain('Economy & Buildings');
    expect(state.players[0].faction_id).toBe('usa');
    expect(state.players[1].faction_id).toBe('germany');
    expect(state.players[0].special_resource).toBe(10);
    expect(state.territories.t1.buildings).toEqual([]);
  });
});

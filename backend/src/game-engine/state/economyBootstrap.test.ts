import { describe, it, expect } from 'vitest';
import type { GameMap, GameSettings } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';

function makeMiniMap(): GameMap {
  return {
    map_id: 'bootstrap_test',
    name: 'Bootstrap Test',
    territories: [
      { territory_id: 't1', name: 'T1', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't2', name: 'T2', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't3', name: 'T3', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't4', name: 'T4', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't5', name: 'T5', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't6', name: 'T6', polygon: [], center_point: [0, 0], region_id: 'r1' },
    ],
    connections: [
      { from: 't1', to: 't2', type: 'land' },
      { from: 't2', to: 't3', type: 'land' },
      { from: 't3', to: 't4', type: 'land' },
      { from: 't4', to: 't5', type: 'land' },
      { from: 't5', to: 't6', type: 'land' },
    ],
    regions: [{ region_id: 'r1', name: 'Region', bonus: 2 }],
  };
}

const players = [
  { player_id: 'p1', player_index: 0, username: 'P1', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000 },
  { player_id: 'p2', player_index: 1, username: 'P2', color: '#00f', is_ai: false, is_eliminated: false, mmr: 1000 },
];

describe('economy+tech bootstrap', () => {
  it('grants starting TP and gold plus opening tick for non-tutorial economy+tech games', () => {
    const settings: GameSettings = {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      economy_tech_starting_tech_points: 3,
      economy_tech_starting_gold: 4,
    };

    const state = initializeGameState('bootstrap-1', 'ancient', makeMiniMap(), players, settings);
    for (const player of state.players) {
      // 3 territories each → +1 TP and +1 gold from opening tick
      expect(player.tech_points).toBeGreaterThanOrEqual(4);
      expect(player.special_resource).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not bootstrap tutorial games', () => {
    const settings: GameSettings = {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      tutorial: true,
    };

    const state = initializeGameState('bootstrap-tutorial', 'ancient', makeMiniMap(), players, settings);
    for (const player of state.players) {
      expect(player.tech_points).toBe(0);
      expect(player.special_resource).toBe(0);
    }
  });

  it('leaves resources at zero when economy or tech is disabled', () => {
    const settings: GameSettings = {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: false,
      tech_trees_enabled: false,
    };

    const state = initializeGameState('bootstrap-off', 'ancient', makeMiniMap(), players, settings);
    for (const player of state.players) {
      expect(player.tech_points).toBeUndefined();
      expect(player.special_resource).toBeUndefined();
    }
  });
});

describe('economy without Technology Trees', () => {
  const economyOnly: GameSettings = {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: false,
  };

  it('pays the first player at their first turn start, as every later seat is paid at its own', () => {
    const map = makeMiniMap();
    const state = initializeGameState('economy-only', 'ancient', map, players, economyOnly);
    const first = state.players[state.current_player_index]!;
    const firstTurn = first.special_resource;
    advanceToNextPlayer(state, map);
    const secondTurn = state.players[state.current_player_index]!.special_resource;
    // Both hold 3 territories: 1 PP each as their first turn begins.
    expect({ firstTurn, secondTurn }).toEqual({ firstTurn: 1, secondTurn: 1 });
  });

  it('pays nobody before their turn: the seat to move second starts at zero', () => {
    const state = initializeGameState('economy-only-2', 'ancient', makeMiniMap(), players, economyOnly);
    const waiting = state.players.filter((_, i) => i !== state.current_player_index);
    expect(waiting.map((p) => p.special_resource)).toEqual([0]);
  });

  it('leaves authored starts alone: the tutorial, campaign missions and daily challenges', () => {
    const authored: Partial<GameSettings>[] = [
      { tutorial: true },
      { is_campaign: true },
      { daily_challenge_date: '2026-09-29' },
    ];
    for (const extra of authored) {
      const state = initializeGameState('economy-only-authored', 'ancient', makeMiniMap(), players, {
        ...economyOnly,
        ...extra,
      });
      expect(state.players.map((p) => p.special_resource)).toEqual([0, 0]);
    }
  });
});

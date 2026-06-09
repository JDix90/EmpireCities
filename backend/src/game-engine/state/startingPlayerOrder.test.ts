import { describe, it, expect } from 'vitest';
import type { GameMap, GameSettings } from '../../types';
import { calculateReinforcements } from '../combat/combatResolver';
import {
  initializeGameState,
  pickStartingPlayerIndex,
  shouldRandomizeStartingPlayer,
} from './gameStateManager';

function makeMiniMap(territoryCount: number): GameMap {
  const territories = Array.from({ length: territoryCount }, (_, i) => ({
    territory_id: `t${i + 1}`,
    name: `T${i + 1}`,
    polygon: [] as number[][],
    center_point: [0, 0] as [number, number],
    region_id: 'r1',
  }));
  return {
    map_id: 'order_test',
    name: 'Order Test',
    territories,
    connections: territories.slice(0, -1).map((t, i) => ({
      from: t.territory_id,
      to: territories[i + 1]!.territory_id,
      type: 'land' as const,
    })),
    regions: [{ region_id: 'r1', name: 'Region', bonus: 2 }],
  };
}

const basePlayers = [
  { player_id: 'p0', player_index: 0, username: 'Host', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000 },
  { player_id: 'p1', player_index: 1, username: 'Guest', color: '#00f', is_ai: false, is_eliminated: false, mmr: 1000 },
];

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    ...overrides,
  };
}

describe('shouldRandomizeStartingPlayer', () => {
  it('returns true for normal games', () => {
    expect(shouldRandomizeStartingPlayer(makeSettings())).toBe(true);
  });

  it('returns false for tutorial', () => {
    expect(shouldRandomizeStartingPlayer(makeSettings({ tutorial: true }))).toBe(false);
  });

  it('returns false for campaign', () => {
    expect(shouldRandomizeStartingPlayer(makeSettings({ is_campaign: true }))).toBe(false);
  });

  it('returns false for daily puzzle', () => {
    expect(shouldRandomizeStartingPlayer(makeSettings({
      daily_challenge_date: '2026-06-07',
      daily_challenge_spec: { archetype: 'domination' },
    }))).toBe(false);
  });
});

describe('pickStartingPlayerIndex', () => {
  it('always returns 0 when randomization is disabled', () => {
    expect(pickStartingPlayerIndex(4, makeSettings({ tutorial: true }))).toBe(0);
  });

  it('uses injected rng for normal games', () => {
    expect(pickStartingPlayerIndex(4, makeSettings(), () => 2)).toBe(2);
  });
});

describe('initializeGameState starting player', () => {
  it('randomizes current and starting index for normal games', () => {
    const state = initializeGameState(
      'g1',
      'ancient',
      makeMiniMap(6),
      basePlayers,
      makeSettings(),
      { forceStartingPlayerIndex: 1 },
    );
    expect(state.starting_player_index).toBe(1);
    expect(state.current_player_index).toBe(1);
  });

  it('keeps seat 0 for tutorial games', () => {
    const state = initializeGameState(
      'g-tutorial',
      'ancient',
      makeMiniMap(6),
      basePlayers,
      makeSettings({ tutorial: true }),
    );
    expect(state.starting_player_index).toBe(0);
    expect(state.current_player_index).toBe(0);
  });

  it('attributes first draft to the starting player not seat 0', () => {
    const state = initializeGameState(
      'g-draft',
      'ancient',
      makeMiniMap(7),
      basePlayers,
      makeSettings(),
      { forceStartingPlayerIndex: 1 },
    );
    const starter = state.players[1]!;
    const seatZero = state.players[0]!;
    expect(starter.territory_count).toBe(3);
    expect(seatZero.territory_count).toBe(4);
    const expectedBase = calculateReinforcements(starter.territory_count, 0, state.players.length);
    expect(state.draft_units_remaining).toBe(expectedBase);
  });

  it('sets territory_select first picker to randomized starter', () => {
    const state = initializeGameState(
      'g-ts',
      'ancient',
      makeMiniMap(6),
      basePlayers,
      makeSettings({ territory_selection: true }),
      { forceStartingPlayerIndex: 1 },
    );
    expect(state.phase).toBe('territory_select');
    expect(state.current_player_index).toBe(1);
    expect(state.starting_player_index).toBe(1);
    expect(state.draft_units_remaining).toBe(0);
  });

  it('produces varied starters across many inits (4-player)', () => {
    const fourPlayers = [
      ...basePlayers,
      { player_id: 'p2', player_index: 2, username: 'P3', color: '#0f0', is_ai: false, is_eliminated: false, mmr: 1000 },
      { player_id: 'p3', player_index: 3, username: 'P4', color: '#ff0', is_ai: false, is_eliminated: false, mmr: 1000 },
    ];
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const state = initializeGameState(`g-${i}`, 'ancient', makeMiniMap(12), fourPlayers, makeSettings());
      seen.add(state.starting_player_index ?? 0);
      expect(state.current_player_index).toBeGreaterThanOrEqual(0);
      expect(state.current_player_index).toBeLessThan(4);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

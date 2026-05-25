import { describe, expect, it } from 'vitest';
import { computeDraftPool } from './draftPool';
import type { GameState } from '../store/gameStore';

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    map_id: 'm1',
    era: 'ancient',
    phase: 'draft',
    turn_number: 1,
    current_player_index: 0,
    turn_started_at: Date.now(),
    players: [
      {
        player_id: 'human-a',
        player_index: 0,
        username: 'Hero',
        color: '#f00',
        is_ai: false,
        is_eliminated: false,
        territory_count: 9,
        cards: [],
      },
    ],
    territories: {},
    settings: { max_players: 2 },
    draft_units_remaining: 5,
    ...overrides,
  } as GameState;
}

describe('computeDraftPool', () => {
  it('returns server draft_units_remaining when present', () => {
    const state = baseState({ draft_units_remaining: 4 });
    expect(computeDraftPool(state, 'human-a', 'Hero', 99, 'human-a')).toBe(4);
  });

  it('returns 0 when server pool is exhausted', () => {
    const state = baseState({ draft_units_remaining: 0 });
    expect(computeDraftPool(state, 'human-a', 'Hero', 99, 'human-a')).toBe(0);
  });

  it('does not invent a pool from territory count when server field is missing', () => {
    const state = baseState({ draft_units_remaining: undefined });
    expect(computeDraftPool(state, 'human-a', 'Hero', 0, 'human-a')).toBe(0);
  });

  it('uses store fallback when server field is missing but client had a prior value', () => {
    const state = baseState({ draft_units_remaining: undefined });
    expect(computeDraftPool(state, 'human-a', 'Hero', 3, 'human-a')).toBe(3);
  });
});

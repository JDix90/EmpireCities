import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { applyEventEffect } from './eventCardManager';

function makePlayer(id: string, index: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: id,
    player_index: index,
    username: id,
    color: '#fff',
    territory_count: 2,
    cards: [],
    is_eliminated: false,
    ...overrides,
  };
}

function makeTerritory(owner: string | null, units: number): TerritoryState {
  return {
    owner_id: owner,
    unit_count: units,
  } as TerritoryState;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ww2',
    turn_number: 2,
    current_player_index: 0,
    phase: 'draft',
    draft_units_remaining: 5,
    draft_placements_this_turn: {},
    turn_started_at: Date.now(),
    players: [makePlayer('p1', 0), makePlayer('p2', 1)],
    territories: {
      a: makeTerritory('p1', 3),
      b: makeTerritory('p1', 2),
    },
    settings: { events_enabled: true } as GameState['settings'],
    diplomacy: [],
    ...overrides,
  } as GameState;
}

describe('applyEventEffect units_added player', () => {
  it('adds reinforcements to draft pool during draft for the current player', () => {
    const state = baseState({ draft_units_remaining: 5 });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 4 },
      false,
    );
    expect(state.draft_units_remaining).toBe(9);
    expect(r.draft_units_granted).toBe(4);
    expect(state.territories.a.unit_count).toBe(3);
    expect(state.territories.b.unit_count).toBe(2);
  });

  it('round-robin distributes on map when not in draft phase', () => {
    const state = baseState({ phase: 'attack', draft_units_remaining: 0 });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 5 },
      false,
    );
    expect(state.draft_units_remaining).toBe(0);
    expect(state.territories.a.unit_count).toBe(6);
    expect(state.territories.b.unit_count).toBe(4);
    expect(r.affected_territories?.reduce((s, x) => s + x.delta, 0)).toBe(5);
  });

  it('credits draft for current player and map for others when affects_all in draft', () => {
    const state = baseState({
      draft_units_remaining: 2,
      territories: {
        a: makeTerritory('p1', 1),
        b: makeTerritory('p2', 4),
        c: makeTerritory('p2', 2),
      },
    });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 2 },
      true,
    );
    expect(state.draft_units_remaining).toBe(4); // p1 current +2
    expect(state.territories.b.unit_count).toBe(5);
    expect(state.territories.c.unit_count).toBe(3);
    expect(r.draft_units_granted).toBe(2);
    expect(r.affected_territories?.length).toBeGreaterThan(0);
  });
});

describe('applyEventEffect region_disaster', () => {
  it('returns per-territory deltas with global flag', () => {
    const state = baseState({
      phase: 'attack',
      territories: {
        a: makeTerritory('p1', 4),
        b: makeTerritory('p2', 3),
        c: makeTerritory('p2', 1),
      },
    });
    const r = applyEventEffect(
      state,
      { type: 'region_disaster', target: 'region', value: 1 },
      false,
    );
    expect(r.global).toBe(true);
    expect(r.affected_territories?.length).toBe(2);
    expect(state.territories.a.unit_count).toBe(3);
    expect(state.territories.b.unit_count).toBe(2);
    expect(state.territories.c.unit_count).toBe(1);
  });
});

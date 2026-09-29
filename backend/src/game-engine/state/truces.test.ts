import { describe, it, expect } from 'vitest';
import type { DiplomacyEntry, GameMap, GameState, PlayerState } from '../../types';
import { activeTruceBetween, agreeTruce, breakTruceBetween, TRUCE_ROUNDS } from './truces';
import { advanceToNextPlayer } from './gameStateManager';
import { applyEventEffect } from '../events/eventCardManager';

/** a, b and c, with a truce in force between b and a unless `entry` says otherwise. */
function state(entry: Partial<DiplomacyEntry> = {}): GameState {
  return {
    players: [
      { player_id: 'a', player_index: 0 },
      { player_id: 'b', player_index: 1 },
      { player_id: 'c', player_index: 2 },
    ] as PlayerState[],
    diplomacy: [{ player_index_a: 1, player_index_b: 0, status: 'truce', truce_turns_remaining: 2, ...entry }],
  } as unknown as GameState;
}

describe('activeTruceBetween', () => {
  it('finds a truce in force whichever way round it was recorded', () => {
    const s = state();
    expect(activeTruceBetween(s, 'a', 'b')).toBe(s.diplomacy[0]);
    expect(activeTruceBetween(s, 'b', 'a')).toBe(s.diplomacy[0]);
  });

  it('ignores a lapsed truce, a neutral pair, and anyone outside it', () => {
    expect(activeTruceBetween(state({ truce_turns_remaining: 0 }), 'a', 'b')).toBeNull();
    expect(activeTruceBetween(state({ status: 'neutral' }), 'a', 'b')).toBeNull();
    expect(activeTruceBetween(state(), 'a', 'c')).toBeNull();
    expect(activeTruceBetween(state(), 'a', null)).toBeNull();
    expect(activeTruceBetween(state(), 'a', 'a')).toBeNull();
  });

  it('reads a board built without a diplomacy list as holding no truces', () => {
    const s = state();
    delete (s as Partial<GameState>).diplomacy;
    expect(activeTruceBetween(s, 'a', 'b')).toBeNull();
  });
});

describe('breakTruceBetween', () => {
  it('returns the pair to neutral and owes the betrayed player a retaliation die', () => {
    const s = state();
    expect(breakTruceBetween(s, 'a', 'b')).toBe(true);
    expect(s.diplomacy[0]).toMatchObject({ status: 'neutral', truce_turns_remaining: 0 });
    expect(s.players[1]!.truce_break_retaliations).toEqual([{ against_player_id: 'a', dice_bonus: 1 }]);
    expect(s.players[0]!.truce_break_retaliations).toBeUndefined();
  });

  it('stacks the die when a new truce is broken before the first die is used', () => {
    const s = state();
    breakTruceBetween(s, 'a', 'b');
    s.diplomacy[0] = { ...s.diplomacy[0]!, status: 'truce', truce_turns_remaining: 3 };
    breakTruceBetween(s, 'a', 'b');
    expect(s.players[1]!.truce_break_retaliations).toEqual([{ against_player_id: 'a', dice_bonus: 2 }]);
  });

  it('changes nothing when there is no truce to break', () => {
    const s = state({ status: 'neutral', truce_turns_remaining: 0 });
    expect(breakTruceBetween(s, 'a', 'b')).toBe(false);
    expect(breakTruceBetween(s, 'a', 'c')).toBe(false);
    expect(s.players.map((p) => p.truce_break_retaliations)).toEqual([undefined, undefined, undefined]);
  });
});

describe('agreeTruce', () => {
  /** Four seats, one tile each, no borders: seat 3 moves last in round 4. */
  const seats = ['s0', 's1', 's2', 's3'];
  const map = {
    map_id: 'truce_rounds',
    name: 'Truce rounds',
    territories: seats.map((id, i) => ({
      territory_id: `t${i}`, name: id, polygon: [], center_point: [i, 0], region_id: `r${i}`,
    })),
    connections: [],
    regions: seats.map((_, i) => ({ region_id: `r${i}`, name: `r${i}`, bonus: 0 })),
  } as unknown as GameMap;

  function round4(currentPlayerIndex: number): GameState {
    return {
      game_id: 'truce-rounds', era: 'custom', map_id: 'truce_rounds', phase: 'attack',
      turn_number: 4, current_player_index: currentPlayerIndex,
      players: seats.map((id, i) => ({
        player_id: id, player_index: i, username: id, color: '#000', is_ai: false, is_eliminated: false,
        territory_count: 1, cards: [], mmr: 1000, capital_territory_id: null, secret_mission: null,
      })),
      territories: Object.fromEntries(seats.map((id, i) => [`t${i}`, {
        territory_id: `t${i}`, owner_id: id, unit_count: 5, unit_type: 'infantry',
      }])),
      card_deck: [], card_set_redemption_count: 0,
      diplomacy: [{ player_index_a: 0, player_index_b: 3, status: 'neutral', truce_turns_remaining: 0 }],
      settings: {
        fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0,
        initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: true,
      },
      draft_units_remaining: 0, turn_started_at: 0,
    } as unknown as GameState;
  }

  /** Whether s0 and s3 are at truce on each of `seat`'s next turns. */
  function coverage(state: GameState, seat: number, turns: number): boolean[] {
    const covered: boolean[] = [];
    for (let i = 0; covered.length < turns && i < 40; i++) {
      advanceToNextPlayer(state, map);
      if (state.current_player_index === seat) covered.push(activeTruceBetween(state, 's0', 's3') !== null);
    }
    return covered;
  }

  it('holds for the three rounds after the one it is agreed in, agreed on the last seat', () => {
    // s3 and s0 agree on s3's turn, the last of round 4: s0 moves next.
    const state = round4(3);
    agreeTruce(state, state.diplomacy[0]!);
    expect(coverage(state, 0, 4)).toEqual([true, true, true, false]);
  });

  it('holds for the three rounds after the one it is agreed in, agreed on the first seat', () => {
    // Agreed on s0's own turn: s3 still moves under it this round.
    const state = round4(0);
    agreeTruce(state, state.diplomacy[0]!);
    expect(coverage(state, 3, 5)).toEqual([true, true, true, true, false]);
  });

  it('counts down from the rounds it promises', () => {
    const state = round4(3);
    agreeTruce(state, state.diplomacy[0]!);
    const left = [state.diplomacy[0]!.truce_turns_remaining];
    for (let i = 0; i < 4; i++) {
      for (let s = 0; s < seats.length; s++) advanceToNextPlayer(state, map);
      left.push(state.diplomacy[0]!.truce_turns_remaining);
    }
    // Agreed in round 4, it reads 3 through round 5 and ends as round 8 begins.
    expect(left).toEqual([TRUCE_ROUNDS, 3, 2, 1, 0]);
  });

  it('lets an event truce landing in the round a truce was agreed count that round, as its card says', () => {
    // Agreed on s0's turn in round 4; the round's card then lands on s3.
    const state = round4(0);
    (state.settings as Record<string, unknown>).event_impact_scaling_enabled = false;
    agreeTruce(state, state.diplomacy[0]!);
    for (let i = 0; i < 3; i++) advanceToNextPlayer(state, map);
    state.players[3]!.last_attacked_player_id = 's0';
    applyEventEffect(state, { type: 'truce', target: 'player', value: 2 });
    expect(state.diplomacy[0]!.truce_turns_remaining).toBe(2);
    expect(coverage(state, 0, 3)).toEqual([true, false, false]);
  });

  it('leaves an event truce counting from the round it is imposed in, as its card says', () => {
    // What a Historical Events card writes: no agreement round to skip.
    const state = round4(3);
    Object.assign(state.diplomacy[0]!, { status: 'truce', truce_turns_remaining: 2 });
    expect(coverage(state, 0, 3)).toEqual([true, false, false]);
  });
});

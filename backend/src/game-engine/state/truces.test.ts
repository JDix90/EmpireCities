import { describe, it, expect } from 'vitest';
import type { DiplomacyEntry, GameState, PlayerState } from '../../types';
import { activeTruceBetween, breakTruceBetween } from './truces';

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

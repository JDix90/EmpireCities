import { describe, it, expect } from 'vitest';
import {
  buildTimeLapseIndices,
  nextTimeLapseIndex,
  prevTimeLapseIndex,
} from './replayTimeLapse';
import type { GameState } from '../store/gameStore';

function snap(turn: number, playerIdx: number): GameState {
  // Only the two fields that buildTimeLapseIndices reads need real values; the
  // rest is irrelevant for this test, so we cast a partial through unknown.
  return { turn_number: turn, current_player_index: playerIdx } as unknown as GameState;
}

describe('buildTimeLapseIndices', () => {
  it('returns empty array for empty input', () => {
    expect(buildTimeLapseIndices([])).toEqual([]);
  });

  it('keeps the LAST frame for each (turn, player) pair', () => {
    // Three mid-turn-1 frames for player 0, then one mid-turn-1 frame for
    // player 1, then turn 2 for player 0. Time-lapse should keep one frame
    // per group, in chronological order.
    const states = [
      snap(1, 0), // i=0
      snap(1, 0), // i=1
      snap(1, 0), // i=2 ← last for (1,0)
      snap(1, 1), // i=3 ← only for (1,1)
      snap(2, 0), // i=4 ← only for (2,0)
    ];
    expect(buildTimeLapseIndices(states)).toEqual([2, 3, 4]);
  });

  it('returns one index per unique (turn, player) pair when there are no duplicates', () => {
    const states = [snap(1, 0), snap(1, 1), snap(2, 0), snap(2, 1)];
    expect(buildTimeLapseIndices(states)).toEqual([0, 1, 2, 3]);
  });

  it('handles missing turn_number / current_player_index gracefully (treated as 0)', () => {
    const states = [
      { } as unknown as GameState,
      { turn_number: undefined, current_player_index: undefined } as unknown as GameState,
      snap(1, 0),
    ];
    // Frames 0 and 1 collapse into the (0,0) group; only the *last* one stays.
    expect(buildTimeLapseIndices(states)).toEqual([1, 2]);
  });
});

describe('nextTimeLapseIndex / prevTimeLapseIndex', () => {
  const indices = [2, 5, 9, 12];

  it('next returns the first index strictly greater than current', () => {
    expect(nextTimeLapseIndex(indices, 0)).toBe(2);
    expect(nextTimeLapseIndex(indices, 2)).toBe(5);
    expect(nextTimeLapseIndex(indices, 8)).toBe(9);
    expect(nextTimeLapseIndex(indices, 12)).toBeNull();
    expect(nextTimeLapseIndex(indices, 99)).toBeNull();
  });

  it('prev returns the last index strictly less than current', () => {
    expect(prevTimeLapseIndex(indices, 0)).toBeNull();
    expect(prevTimeLapseIndex(indices, 2)).toBeNull();
    expect(prevTimeLapseIndex(indices, 5)).toBe(2);
    expect(prevTimeLapseIndex(indices, 12)).toBe(9);
    expect(prevTimeLapseIndex(indices, 99)).toBe(12);
  });

  it('handles empty index list', () => {
    expect(nextTimeLapseIndex([], 0)).toBeNull();
    expect(prevTimeLapseIndex([], 99)).toBeNull();
  });
});

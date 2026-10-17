import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { noteCapture, noteFewestTerritories, noteTerritoryLost } from './achievementTally';

function player(id: string, extras: Partial<PlayerState> = {}): PlayerState {
  return { player_id: id, is_eliminated: false, cards: [], ...extras } as PlayerState;
}

/** A board where each player holds the number of territories given. */
function board(turn: number, players: PlayerState[], held: Record<string, number>, neutral = 0): GameState {
  const territories: Record<string, TerritoryState> = {};
  const add = (owner: string | null) => {
    const id = `t${Object.keys(territories).length}`;
    territories[id] = { territory_id: id, owner_id: owner, unit_count: 1 } as TerritoryState;
  };
  for (const [owner, n] of Object.entries(held)) for (let i = 0; i < n; i++) add(owner);
  for (let i = 0; i < neutral; i++) add(null);
  return { turn_number: turn, players, territories } as unknown as GameState;
}

describe('noteCapture (Blitzkrieg)', () => {
  it("counts a turn's captures and keeps the best turn", () => {
    const p = player('p1');
    for (let i = 0; i < 3; i++) noteCapture(p);
    expect([p.territories_captured_this_turn, p.territories_captured_turn_max]).toEqual([3, 3]);
    p.territories_captured_this_turn = 0; // the hand-off
    noteCapture(p);
    expect([p.territories_captured_this_turn, p.territories_captured_turn_max]).toEqual([1, 3]);
  });
});

describe('noteTerritoryLost (Perfect Defense)', () => {
  it('counts a loss from turn 4 on, and none before', () => {
    const p = player('p1', { territories_lost_after_turn_3: 0 });
    noteTerritoryLost(board(3, [p], {}), 'p1');
    expect(p.territories_lost_after_turn_3).toBe(0);
    noteTerritoryLost(board(4, [p], {}), 'p1');
    expect(p.territories_lost_after_turn_3).toBe(1);
  });

  it('ignores a neutral territory, and a game that began before the count', () => {
    const counted = player('p1', { territories_lost_after_turn_3: 0 });
    noteTerritoryLost(board(5, [counted], {}), null);
    expect(counted.territories_lost_after_turn_3).toBe(0);
    // No count from the start, so no number that could read as a perfect defence.
    const legacy = player('p1');
    noteTerritoryLost(board(5, [legacy], {}), 'p1');
    expect(legacy.territories_lost_after_turn_3).toBeUndefined();
  });
});

describe('noteFewestTerritories (Comeback King)', () => {
  it('marks the player holding strictly the fewest, from turn 2 on', () => {
    const [a, b, c] = [player('a'), player('b'), player('c')];
    noteFewestTerritories(board(1, [a, b, c], { a: 5, b: 4, c: 3 }));
    expect(c.held_fewest_territories).toBeUndefined();
    noteFewestTerritories(board(2, [a, b, c], { a: 5, b: 4, c: 3 }, 6));
    expect([a, b, c].map((p) => p.held_fewest_territories)).toEqual([undefined, undefined, true]);
  });

  it('marks nobody on a tie for the fewest', () => {
    const [a, b, c] = [player('a'), player('b'), player('c')];
    noteFewestTerritories(board(3, [a, b, c], { a: 5, b: 3, c: 3 }));
    expect([a, b, c].some((p) => p.held_fewest_territories)).toBe(false);
  });

  it('leaves eliminated players out, and needs two still in', () => {
    const out = player('out', { is_eliminated: true });
    const [a, b] = [player('a'), player('b')];
    noteFewestTerritories(board(3, [out, a, b], { a: 4, b: 2 }));
    expect([out, a, b].map((p) => p.held_fewest_territories)).toEqual([undefined, undefined, true]);
    const last = player('last');
    noteFewestTerritories(board(3, [player('gone', { is_eliminated: true }), last], { last: 1 }));
    expect(last.held_fewest_territories).toBeUndefined();
  });
});

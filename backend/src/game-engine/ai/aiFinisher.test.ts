import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import { eliminationAttackBonus } from './aiBot';

function makePlayer(id: string, territoryCount: number, eliminated = false): PlayerState {
  return {
    player_id: id,
    player_index: 0,
    username: id,
    color: '#fff',
    is_ai: false,
    is_eliminated: eliminated,
    territory_count: territoryCount,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
  };
}

function makeState(players: PlayerState[]): GameState {
  return { players, territories: {} } as unknown as GameState;
}

describe('eliminationAttackBonus', () => {
  it('rewards attacks on a 1-territory opponent most', () => {
    const state = makeState([makePlayer('victim', 1)]);
    const oneLeft = eliminationAttackBonus(state, 'victim', 'medium');
    const twoLeft = eliminationAttackBonus(makeState([makePlayer('victim', 2)]), 'victim', 'medium');
    expect(oneLeft).toBeGreaterThan(twoLeft);
    expect(twoLeft).toBeGreaterThan(0);
  });

  it('gives no bonus against healthy opponents', () => {
    const state = makeState([makePlayer('victim', 5)]);
    expect(eliminationAttackBonus(state, 'victim', 'hard')).toBe(0);
  });

  it('easy and tutorial difficulties stay forgiving', () => {
    const state = makeState([makePlayer('victim', 1)]);
    expect(eliminationAttackBonus(state, 'victim', 'easy')).toBe(0);
    expect(eliminationAttackBonus(state, 'victim', 'tutorial')).toBe(0);
  });

  it('ignores neutral and already-eliminated owners', () => {
    const state = makeState([makePlayer('victim', 1, true)]);
    expect(eliminationAttackBonus(state, null, 'expert')).toBe(0);
    expect(eliminationAttackBonus(state, 'victim', 'expert')).toBe(0);
  });
});

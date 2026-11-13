/**
 * Even deal (even_deal_enabled, gameStateManager evenDealShape): a dealt board
 * that does not divide evenly no longer hands every leftover territory to the
 * lowest seats. Two players: the leftover starts neutral. Three or more: the
 * leftovers go to seats from a random one.
 */
import { describe, it, expect, vi } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { evenDealShape, initializeGameState } from './gameStateManager';

/** `count` territories in one region, chained. */
function board(count: number): GameMap {
  return {
    map_id: `even_${count}`,
    name: 'Even deal test',
    territories: Array.from({ length: count }, (_, i) => ({
      territory_id: `t${i}`, name: `T${i}`, polygon: [], center_point: [i, 0] as [number, number], region_id: 'r',
    })),
    connections: Array.from({ length: count - 1 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}`, type: 'land' as const })),
    regions: [{ region_id: 'r', name: 'R', bonus: 5 }],
  } as GameMap;
}

function deal(map: GameMap, seats: number, on: boolean, extra: Record<string, unknown> = {}): GameState {
  return initializeGameState(
    `even-${map.map_id}-${seats}`,
    'medieval',
    map,
    Array.from({ length: seats }, (_, i) => ({
      player_id: `p${i}`, player_index: i, username: `P${i}`, color: '#abc', is_ai: false, is_eliminated: false, mmr: 1000,
    })),
    {
      fog_of_war: false,
      allowed_victory_conditions: ['domination'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      ...(on ? { even_deal_enabled: true } : {}),
      ...extra,
    },
    { forceStartingPlayerIndex: 0 },
  );
}

const held = (state: GameState) => state.players.map((p) =>
  Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length);
const neutral = (state: GameState) => Object.values(state.territories).filter((t) => t.owner_id == null);

describe('evenDealShape', () => {
  it('is the old deal with the setting off or on a board that divides evenly, and draws nothing', () => {
    const rng = vi.fn(() => 1);
    expect(evenDealShape({}, 33, 2, rng)).toEqual({ dealt: 33, offset: 0 });
    expect(evenDealShape({ even_deal_enabled: true }, 34, 2, rng)).toEqual({ dealt: 34, offset: 0 });
    expect(evenDealShape({ even_deal_enabled: true }, 36, 3, rng)).toEqual({ dealt: 36, offset: 0 });
    expect(rng).not.toHaveBeenCalled();
  });

  it('leaves a two-player leftover undealt, and starts three or more from a random seat', () => {
    expect(evenDealShape({ even_deal_enabled: true }, 33, 2)).toEqual({ dealt: 32, offset: 0 });
    expect(evenDealShape({ even_deal_enabled: true }, 35, 3, () => 2)).toEqual({ dealt: 35, offset: 2 });
  });
});

describe('the even deal at game start', () => {
  it('two players on 33 territories: 16 each and one neutral with the usual garrison', () => {
    const state = deal(board(33), 2, true);
    expect(held(state)).toEqual([16, 16]);
    expect(neutral(state).map((t) => t.unit_count)).toEqual([3]);
  });

  it('without the setting the host holds the extra territory, as before', () => {
    const state = deal(board(33), 2, false);
    expect(held(state)).toEqual([17, 16]);
    expect(neutral(state)).toEqual([]);
  });

  it('two players on an even board: nothing neutral', () => {
    expect(neutral(deal(board(34), 2, true))).toEqual([]);
  });

  it('three players: the extra territory is not always the host’s, and nobody is short more than one', () => {
    const extraSeats = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const counts = held(deal(board(34), 3, true));
      expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
      extraSeats.add(counts.indexOf(12));
    }
    // Each draw lands on one of three seats; all 60 on the host's is (1/3)^60.
    expect(extraSeats.size).toBeGreaterThan(1);
    expect(held(deal(board(34), 3, false))).toEqual([12, 11, 11]);
  });

  it('the starting player still opens with their reinforcements on the dealt board', () => {
    const state = deal(board(33), 2, true);
    // 16 territories: 16 / 3 = 5, and the neutral tile blocks the region bonus.
    expect(state.draft_units_remaining).toBe(5);
  });
});

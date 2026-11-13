/**
 * Two-player opening balance (duel_opening_enabled, state/duelOpening.ts): the
 * first mover's opening turn places at most 3 units, the second mover's first
 * turn 1 more than usual, and nothing else changes.
 *
 * The board is 45 territories in one region nobody can hold whole, so a
 * player's usual reinforcements are territories / 3: 7 for each of two seats
 * (23 and 22 territories), 5 for each of three.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import { duelOpeningApplies, duelOpeningFirstMoverUnits } from './duelOpening';

const MAP: GameMap = {
  map_id: 'duel_test',
  name: 'Duel test',
  territories: Array.from({ length: 45 }, (_, i) => ({
    territory_id: `t${i}`, name: `T${i}`, polygon: [], center_point: [i, 0] as [number, number], region_id: 'r',
  })),
  connections: Array.from({ length: 44 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}`, type: 'land' as const })),
  regions: [{ region_id: 'r', name: 'R', bonus: 5 }],
} as GameMap;

function game(seats: number, opts: { on?: boolean; start?: number; extra?: Record<string, unknown>; mapId?: string } = {}): GameState {
  return initializeGameState(
    `duel-${seats}-${opts.start ?? 0}`,
    'medieval',
    opts.mapId ? { ...MAP, map_id: opts.mapId } : MAP,
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
      ...(opts.on ? { duel_opening_enabled: true } : {}),
      ...opts.extra,
    },
    { forceStartingPlayerIndex: opts.start ?? 0 },
  );
}

/** Each turn's units to place, in play order, for `turns` turns from the start. */
function drafts(state: GameState, turns: number): Array<{ seat: number; round: number; units: number }> {
  const out = [];
  for (let k = 0; k < turns; k++) {
    if (k > 0) advanceToNextPlayer(state, MAP);
    out.push({ seat: state.current_player_index, round: state.turn_number, units: state.draft_units_remaining });
  }
  return out;
}

describe('the two-player opening balance', () => {
  it('opens the first mover with 3 and gives the second mover 1 extra, then leaves every turn alone', () => {
    expect(drafts(game(2, { on: true }), 4)).toEqual([
      { seat: 0, round: 1, units: 3 },
      { seat: 1, round: 1, units: 8 },
      { seat: 0, round: 2, units: 7 },
      { seat: 1, round: 2, units: 7 },
    ]);
  });

  it('follows whoever was drawn to move first, not seat 0', () => {
    expect(drafts(game(2, { on: true, start: 1 }), 3)).toEqual([
      { seat: 1, round: 1, units: 3 },
      { seat: 0, round: 1, units: 8 },
      { seat: 1, round: 2, units: 7 },
    ]);
  });

  it('opens the first mover with 4 on Modern, its one exception', () => {
    expect(drafts(game(2, { on: true, mapId: 'era_modern' }), 3)).toEqual([
      { seat: 0, round: 1, units: 4 },
      { seat: 1, round: 1, units: 8 },
      { seat: 0, round: 2, units: 7 },
    ]);
    expect(duelOpeningFirstMoverUnits('era_modern')).toBe(4);
    expect(duelOpeningFirstMoverUnits('era_coldwar')).toBe(3);
    expect(duelOpeningFirstMoverUnits(undefined)).toBe(3);
  });

  it('is the usual opening without the setting', () => {
    expect(drafts(game(2), 2).map((d) => d.units)).toEqual([7, 7]);
  });

  it('leaves a three-player game alone', () => {
    expect(drafts(game(3, { on: true }), 3).map((d) => d.units)).toEqual([5, 5, 5]);
  });

  it('never applies to a team game, a Territory Selection game, or after round 1', () => {
    const base = { settings: { duel_opening_enabled: true }, players: [{}, {}], turn_number: 1 } as unknown as GameState;
    expect(duelOpeningApplies(base)).toBe(true);
    expect(duelOpeningApplies({ ...base, teams: [{ team_id: 'a', name: 'A', player_ids: ['p0', 'p1'] }] } as GameState)).toBe(false);
    expect(duelOpeningApplies({ ...base, settings: { duel_opening_enabled: true, territory_selection: true } } as unknown as GameState)).toBe(false);
    expect(duelOpeningApplies({ ...base, turn_number: 2 })).toBe(false);
  });

  it('places nothing extra in a Territory Selection game, which deals no opening at the start', () => {
    const state = game(2, { on: true, extra: { territory_selection: true } });
    expect(state.phase).toBe('territory_select');
    expect(state.draft_units_remaining).toBe(0);
  });
});

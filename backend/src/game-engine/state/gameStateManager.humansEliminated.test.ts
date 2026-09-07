import { describe, it, expect } from 'vitest';
import { checkVictory } from './gameStateManager';
import type { GameState, GameMap } from '../../types';

/**
 * When the AI wipes out every human, the surviving bots used to keep taking
 * turns against each other until the turn limit — with nobody watching, and
 * with the human who was just eliminated never getting a result screen.
 */
const MAP = { territories: [], connections: [], regions: [] } as unknown as GameMap;

interface Seat {
  player_id: string;
  is_ai?: boolean;
  is_eliminated?: boolean;
  territory_count?: number;
  /** Units above the one-per-territory baseline, for the tie-break case. */
  extra_units?: number;
}

/**
 * Builds a state whose territory map actually matches the seats'
 * `territory_count`s — one territory each, holding one unit plus any
 * `extra_units`. That consistency is load-bearing: `checkVictory` reads
 * domination as `territory_count >= Object.keys(state.territories).length`, so
 * a fixture with an empty map hands the first seat a domination win at zero
 * territories, and the cases that assert "the game keeps going" would fail for
 * a reason that has nothing to do with human elimination.
 */
function state(seats: Seat[]): GameState {
  const territories: Record<string, unknown> = {};
  let n = 0;
  for (const seat of seats) {
    for (let i = 0; i < (seat.territory_count ?? 0); i++, n++) {
      territories[`t${n}`] = {
        territory_id: `t${n}`,
        owner_id: seat.player_id,
        unit_count: 1 + (i === 0 ? seat.extra_units ?? 0 : 0),
      };
    }
  }
  return {
    phase: 'attack',
    turn_number: 12,
    current_player_index: 0,
    settings: { allowed_victory_conditions: ['domination'] },
    diplomacy: [],
    territories,
    players: seats.map((seat, i) => ({
      player_id: seat.player_id,
      player_index: i,
      username: seat.player_id,
      is_ai: seat.is_ai ?? false,
      is_eliminated: seat.is_eliminated ?? false,
      territory_count: seat.territory_count ?? 0,
    })),
  } as unknown as GameState;
}

describe('checkVictory — every human eliminated', () => {
  it('ends the game and credits the leading AI', () => {
    const s = state([
      { player_id: 'human', is_ai: false, is_eliminated: true, territory_count: 0 },
      { player_id: 'ai_a', is_ai: true, territory_count: 12 },
      { player_id: 'ai_b', is_ai: true, territory_count: 20 },
    ]);
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['ai_b'], condition: 'humans_eliminated' });
  });

  it('breaks a territory tie on total units', () => {
    const s = state([
      { player_id: 'human', is_ai: false, is_eliminated: true },
      { player_id: 'ai_a', is_ai: true, territory_count: 10 },
      { player_id: 'ai_b', is_ai: true, territory_count: 10, extra_units: 5 },
    ]);
    expect(checkVictory(s, MAP)?.winnerIds).toEqual(['ai_b']);
  });

  it('keeps playing while any human is still alive', () => {
    const s = state([
      { player_id: 'human_a', is_ai: false, is_eliminated: true },
      { player_id: 'human_b', is_ai: false, is_eliminated: false, territory_count: 2 },
      { player_id: 'ai_a', is_ai: true, territory_count: 20 },
    ]);
    expect(checkVictory(s, MAP)).toBeNull();
  });

  it('leaves an all-AI match alone — nothing was ever there to end it for', () => {
    // Simulations and seeded fixtures have no human seat; ending them the
    // instant they start would break every AI-vs-AI harness.
    const s = state([
      { player_id: 'ai_a', is_ai: true, territory_count: 10 },
      { player_id: 'ai_b', is_ai: true, territory_count: 10 },
    ]);
    expect(checkVictory(s, MAP)).toBeNull();
  });

  it('still prefers last-standing when only one player of any kind remains', () => {
    const s = state([
      { player_id: 'human', is_ai: false, is_eliminated: true },
      { player_id: 'ai_a', is_ai: true, is_eliminated: true },
      { player_id: 'ai_b', is_ai: true, territory_count: 20 },
    ]);
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['ai_b'], condition: 'last_standing' });
  });
});

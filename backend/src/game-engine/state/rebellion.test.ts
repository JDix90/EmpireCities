import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Every roll comes up 0: a territory at the rebellion threshold always rebels,
// and the round's event draw takes the first card of the deck.
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

import { randomInt } from 'crypto';
import type { EventCard, GameMap, GameState, PlayerState, TerritoryState } from '../../types';
import { applyStabilityTick } from './stabilityManager';
import { advanceToNextPlayer, checkVictory } from './gameStateManager';
import { executeLandAttack } from '../combat/executeLandAttack';

function player(id: string, idx: number): PlayerState {
  return {
    player_id: id, player_index: idx, username: id, color: '#000', is_ai: false, is_eliminated: false,
    territory_count: 1, cards: [], mmr: 1000, capital_territory_id: null, secret_mission: null,
  } as PlayerState;
}

/** A territory at `stability`: 5 is past the rebellion threshold (10), 80 is safe. */
function terr(id: string, owner: string, units: number, stability: number): TerritoryState {
  return {
    territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry',
    world_id: 'earth', stability, population: 1,
  } as TerritoryState;
}

function game(territories: TerritoryState[], seats: string[], overrides: Partial<GameState> = {}): GameState {
  const state = {
    game_id: 'rebellion', era: 'custom', map_id: 'rebellion', phase: 'fortify',
    current_player_index: seats.length - 1, turn_number: 3,
    players: seats.map((id, i) => player(id, i)),
    territories: Object.fromEntries(territories.map((t) => [t.territory_id, t])),
    card_deck: [], card_set_redemption_count: 0, diplomacy: [],
    settings: {
      fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0,
      initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false, stability_enabled: true,
    },
    draft_units_remaining: 0, turn_started_at: Date.now(),
    ...overrides,
  } as unknown as GameState;
  for (const p of state.players) {
    p.territory_count = territories.filter((t) => t.owner_id === p.player_id).length;
  }
  return state;
}

const map = {
  map_id: 'rebellion', name: 'Rebellion',
  territories: ['z0', 'z0b', 'z1', 'z2'].map((id) => ({
    territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: `r_${id}`,
  })),
  connections: [],
  regions: ['z0', 'z0b', 'z1', 'z2'].map((id) => ({ region_id: `r_${id}`, name: id, bonus: 0 })),
} as unknown as GameMap;

beforeEach(() => {
  vi.mocked(randomInt).mockImplementation((() => 0) as never);
});
afterEach(() => {
  vi.mocked(randomInt).mockReset();
});

describe('a rebellion that takes a territory', () => {
  it('leaves the rebels holding it, which anyone can then attack', () => {
    const state = game([terr('z0', 'p0', 1, 5), terr('z0b', 'p0', 3, 80), terr('z1', 'p1', 6, 80)], ['p0', 'p1']);
    expect(applyStabilityTick(state, 'p0')).toEqual(['z0']);
    // An empty neutral can never be attacked: the tile was lost to everyone.
    expect({ owner: state.territories.z0.owner_id, units: state.territories.z0.unit_count })
      .toEqual({ owner: null, units: 1 });
    const rolls = [6, 6, 6, 1]; // attacker's three dice, then the rebels' one
    expect(executeLandAttack(state, 'p1', 'z1', 'z0', { dieRoll: () => rolls.shift() ?? 1 })?.captured).toBe(true);
  });

  it('does not eliminate a player who still holds territory', () => {
    const state = game([terr('z0', 'p0', 1, 5), terr('z0b', 'p0', 3, 80), terr('z1', 'p1', 6, 80)], ['p0', 'p1']);
    applyStabilityTick(state, 'p0');
    expect(state.players[0]).toMatchObject({ territory_count: 1, is_eliminated: false });
  });

  it('eliminates the player whose last territory it was', () => {
    const state = game([terr('z0', 'p0', 1, 5), terr('z1', 'p1', 6, 80)], ['p0', 'p1']);
    applyStabilityTick(state, 'p0');
    expect(state.players[0]).toMatchObject({ territory_count: 0, is_eliminated: true });
  });
});

describe('a player whose last territory rebels as their turn begins', () => {
  it('is out: with one rival left, the rival stands alone', () => {
    // p1 ends the turn; p0's turn opens with the rebellion.
    const state = game([terr('z0', 'p0', 1, 5), terr('z1', 'p1', 6, 80)], ['p0', 'p1']);
    advanceToNextPlayer(state, map);
    expect(state.players[0]!.is_eliminated).toBe(true);
    expect(checkVictory(state, map)).toEqual({ winnerIds: ['p1'], condition: 'last_standing' });
  });

  it('loses the turn to the next living seat, which opens the round with its card', () => {
    // p2 ends the round. The new round's card hits everyone, and p0 would have
    // opened it: the card has to land at p1's turn start instead.
    const levy = {
      card_id: 'levy', title: 'Levy', description: '+5 on z2', category: 'global', era_id: 'custom',
      affects_all_players: true,
      effect: { type: 'units_added', target: 'territory', target_id: 'z2', value: 5 },
    } as EventCard;
    const state = game(
      [terr('z0', 'p0', 1, 5), terr('z1', 'p1', 3, 80), terr('z2', 'p2', 3, 80)],
      ['p0', 'p1', 'p2'],
      {
        seasonal_event_cards: [levy],
        settings: {
          fog_of_war: false, allowed_victory_conditions: ['domination'], turn_timer_seconds: 0,
          initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
          stability_enabled: true, events_enabled: true, event_impact_scaling_enabled: false,
        } as GameState['settings'],
      },
    );
    advanceToNextPlayer(state, map);
    expect({
      seat: state.current_player_index,
      round: state.turn_number,
      p0Out: state.players[0]!.is_eliminated,
      z2: state.territories.z2.unit_count,
      card: state.active_event?.card_id,
    }).toEqual({ seat: 1, round: 4, p0Out: true, z2: 8, card: 'levy' });
    expect(checkVictory(state, map)).toBeNull();
  });
});

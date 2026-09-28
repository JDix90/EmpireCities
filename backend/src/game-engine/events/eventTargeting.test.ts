import { describe, it, expect } from 'vitest';
import { initializeGameState, advanceToNextPlayer } from '../state/gameStateManager';
import type { EventCard, GameMap, GameSettings } from '../../types';

const map: GameMap = {
  map_id: 'event_map',
  name: 'Events',
  territories: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
    territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r',
  })),
  connections: [],
  regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
} as unknown as GameMap;

const targeted: EventCard = {
  card_id: 'test_levy', title: 'Levy', description: '', category: 'military', era_id: 'custom',
  effect: { type: 'units_added', target: 'player', value: 1 },
} as EventCard;

const choice: EventCard = {
  card_id: 'test_choice', title: 'Choice', description: '', category: 'political', era_id: 'custom',
  choices: [
    { choice_id: 'x', label: 'X', effect: { type: 'units_added', target: 'player', value: 1 } },
    { choice_id: 'y', label: 'Y', effect: { type: 'units_added', target: 'player', value: 1 } },
  ],
} as unknown as EventCard;

const everyone: EventCard = { ...targeted, card_id: 'test_all', affects_all_players: true };

/** A 3-seat game whose only event card is `card` ('custom' has no era deck). */
function game(card: EventCard) {
  const players = ['p0', 'p1', 'p2'].map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#000', is_ai: true, is_eliminated: false, mmr: 1000,
  }));
  const state = initializeGameState('events', 'custom', map, players, {
    fog_of_war: false, victory_type: 'domination', allowed_victory_conditions: ['domination'],
    turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
    events_enabled: true,
  } as GameSettings);
  state.seasonal_event_cards = [card];
  state.current_player_index = 0;
  return state;
}

/** Plays `turns` turns and records whose turn each card reached, clearing it as the socket layer does. */
function recipients(card: EventCard, turns: number): string[] {
  const state = game(card);
  const got: string[] = [];
  for (let i = 0; i < turns; i++) {
    state.phase = 'fortify';
    advanceToNextPlayer(state, map);
    if (state.active_event) {
      got.push(state.players[state.current_player_index]!.player_id);
      state.active_event = undefined;
    }
  }
  return got;
}

describe('event card targeting', () => {
  it('rotates single-player cards through the seats instead of always hitting the round opener', () => {
    // 3 seats, 12 turns = 4 round wraps.
    expect(recipients(targeted, 12)).toEqual(['p0', 'p1', 'p2', 'p0']);
  });

  it('rotates choice cards the same way, so every player gets to choose', () => {
    expect(recipients(choice, 12)).toEqual(['p0', 'p1', 'p2', 'p0']);
  });

  it('still resolves cards that hit every player at the start of the round', () => {
    expect(recipients(everyone, 12)).toEqual(['p0', 'p0', 'p0', 'p0']);
  });

  it('skips eliminated seats when choosing the target', () => {
    const state = game(targeted);
    state.players[1]!.is_eliminated = true;
    const got: string[] = [];
    for (let i = 0; i < 9; i++) {
      state.phase = 'fortify';
      advanceToNextPlayer(state, map);
      if (state.active_event) {
        got.push(state.players[state.current_player_index]!.player_id);
        state.active_event = undefined;
      }
    }
    expect(got).toEqual(['p0', 'p2', 'p0', 'p2']);
  });

  it('applies an instant card once even if a hand-off leaves it active', () => {
    // +5 on one tile: whoever holds it, each application shows.
    const levy: EventCard = {
      card_id: 'test_levy_tile', title: 'Levy', description: '', category: 'military', era_id: 'custom',
      effect: { type: 'units_added', target: 'territory', target_id: 'a', value: 5 },
    } as EventCard;
    const state = game(levy);
    state.seasonal_event_cards = [];
    state.pending_event = { card: levy, target_player_id: 'p1' };
    const before = state.territories.a!.unit_count;

    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // p1's turn opens with the card
    expect(state.territories.a!.unit_count).toBe(before + 5);

    // A caller that saved before retiring the card reloads it still active.
    state.phase = 'fortify';
    advanceToNextPlayer(state, map);
    expect(state.territories.a!.unit_count).toBe(before + 5);
    expect(state.active_event).toBeUndefined();
  });

  it('keeps an unresolved choice card across a hand-off', () => {
    const state = game(choice);
    state.seasonal_event_cards = [];
    state.active_event = choice;
    state.phase = 'fortify';
    advanceToNextPlayer(state, map);
    expect(state.active_event?.card_id).toBe('test_choice');
  });

  it('keeps the queued card off the client state', async () => {
    const { redactServerOnlyState } = await import('../../sockets/clientStateRedaction');
    const state = game(targeted);
    state.pending_event = { card: targeted, target_player_id: 'p2' };
    expect(redactServerOnlyState(state).pending_event).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { noteEventLosses, noteRoundEnd, noteTurnEnd, noteTurnStart, worstRoundLoss } from './lossTally';
import { advanceToNextPlayer } from './gameStateManager';
import { applyEventEffect } from '../events/eventCardManager';
import type { GameMap, GameState, PlayerState, TerritoryCard, TerritoryState } from '../../types';

function player(id: string, idx: number, extras?: Partial<PlayerState>): PlayerState {
  return {
    player_id: id, player_index: idx, username: id, color: '#000', is_ai: false,
    is_eliminated: false, territory_count: 0, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null, ...extras,
  };
}

function terr(id: string, owner: string | null, units: number): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' };
}

function game(overrides?: Partial<GameState>): GameState {
  return {
    game_id: 'g', era: 'ancient', map_id: 'm', phase: 'fortify',
    current_player_index: 0, turn_number: 3,
    players: [player('p1', 0, { territory_count: 2 }), player('p2', 1, { territory_count: 1 })],
    territories: { t1: terr('t1', 'p1', 6), t2: terr('t2', 'p1', 2), t3: terr('t3', 'p2', 5) },
    card_deck: [], card_set_redemption_count: 0, diplomacy: [],
    settings: {
      fog_of_war: false, victory_type: 'domination', allowed_victory_conditions: ['domination'],
      turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false,
    },
    draft_units_remaining: 0, turn_started_at: Date.now(), win_probability_history: [],
    ...overrides,
  } as GameState;
}

const SET: TerritoryCard[] = [
  { card_id: 'a', territory_id: 't1', symbol: 'infantry' },
  { card_id: 'b', territory_id: 't2', symbol: 'cavalry' },
  { card_id: 'c', territory_id: 't3', symbol: 'artillery' },
];
const NO_SET: TerritoryCard[] = SET.slice(0, 2);

describe('units lost to events', () => {
  it('credits each removed unit to the territory\'s owner, and nothing for units added', () => {
    const state = game();
    noteEventLosses(state, {
      affected_territories: [
        { territory_id: 't1', delta: -3 }, { territory_id: 't2', delta: -1 },
        { territory_id: 't3', delta: -2 }, { territory_id: 't3', delta: 4 },
      ],
    });
    expect(state.players[0].units_lost_to_events).toBe(4);
    expect(state.players[1].units_lost_to_events).toBe(2);
  });

  it('is counted by applyEventEffect itself', () => {
    const state = game();
    applyEventEffect(state, { type: 'units_removed', target: 'player', value: 3 });
    // The current player's biggest stack gives up the units.
    expect(state.territories.t1.unit_count).toBe(3);
    expect(state.players[0].units_lost_to_events).toBe(3);
    expect(state.players[1].units_lost_to_events).toBeUndefined();
  });
});

describe('turns ended holding a card set', () => {
  it('counts a turn that began with a set and traded none', () => {
    const p = player('p1', 0, { cards: SET, cards_redeemed_count: 1 });
    noteTurnStart(p);
    noteTurnEnd(p);
    expect(p.turns_ended_with_set).toBe(1);
    expect(p.set_in_hand_at_turn_start).toBeUndefined();
  });

  it('does not count a turn whose set was traded', () => {
    const p = player('p1', 0, { cards: SET, cards_redeemed_count: 1 });
    noteTurnStart(p);
    p.cards = [];
    p.cards_redeemed_count = 2;
    noteTurnEnd(p);
    expect(p.turns_ended_with_set).toBeUndefined();
  });

  it('does not count a set completed by this turn\'s own card', () => {
    const p = player('p1', 0, { cards: NO_SET });
    noteTurnStart(p);
    p.cards = SET;
    noteTurnEnd(p);
    expect(p.turns_ended_with_set).toBeUndefined();
  });

  it('does not count a player who is out', () => {
    const p = player('p1', 0, { cards: SET });
    noteTurnStart(p);
    p.is_eliminated = true;
    noteTurnEnd(p);
    expect(p.turns_ended_with_set).toBeUndefined();
  });
});

describe('the worst round for territories', () => {
  it('starts measuring after the first round, and keeps the biggest fall', () => {
    const state = game({ turn_number: 1 });
    const p1 = state.players[0];
    p1.territory_count = 6;
    noteRoundEnd(state);
    expect(p1.worst_round_loss).toBeUndefined();

    state.turn_number = 2;
    p1.territory_count = 4;
    noteRoundEnd(state);
    expect(p1.worst_round_loss).toEqual({ turn: 2, from: 6, to: 4 });

    state.turn_number = 3;
    p1.territory_count = 5;
    noteRoundEnd(state);
    state.turn_number = 4;
    p1.territory_count = 4;
    noteRoundEnd(state);
    expect(p1.worst_round_loss).toEqual({ turn: 2, from: 6, to: 4 });

    state.turn_number = 5;
    p1.territory_count = 1;
    noteRoundEnd(state);
    expect(p1.worst_round_loss).toEqual({ turn: 5, from: 4, to: 1 });
  });

  it('counts the round the game ended in', () => {
    const state = game({ turn_number: 7 });
    const p1 = state.players[0];
    p1.worst_round_loss = { turn: 4, from: 5, to: 3 };
    p1.round_start_territory_count = 4;
    p1.territory_count = 0;
    expect(worstRoundLoss(state, p1)).toEqual({ turn: 7, from: 4, to: 0 });
    p1.territory_count = 3;
    expect(worstRoundLoss(state, p1)).toEqual({ turn: 4, from: 5, to: 3 });
  });

  it('is null for a player who never lost ground', () => {
    const state = game();
    expect(worstRoundLoss(state, state.players[0])).toBeNull();
  });
});

describe('through advanceToNextPlayer', () => {
  const map: GameMap = {
    map_id: 'm', name: 'M',
    territories: ['t1', 't2', 't3'].map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: [], regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as GameMap;

  it('tallies a held set at the turn end, and the round\'s fall as it closes', () => {
    const state = game({ current_player_index: 1 });
    // p2 ends a turn it began holding a set it never traded.
    state.players[1].cards = SET;
    noteTurnStart(state.players[1]);
    state.players[0].round_start_territory_count = 4;
    advanceToNextPlayer(state, map);
    expect(state.current_player_index).toBe(0);
    expect(state.turn_number).toBe(4);
    expect(state.players[1].turns_ended_with_set).toBe(1);
    // p1 held 4 as round 3 began and 2 as it ended.
    expect(state.players[0].worst_round_loss).toEqual({ turn: 3, from: 4, to: 2 });
    expect(state.players[0].round_start_territory_count).toBe(2);
  });
});

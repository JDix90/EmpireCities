/**
 * First-turn measurement (first_turn_events_enabled): which steps of a real
 * game's first turn a change of view reached.
 */
import { describe, it, expect } from 'vitest';
import { newFirstTurnSteps, type FirstTurnStep, type FirstTurnView } from './firstTurnSteps';

const view = (o: Partial<FirstTurnView> = {}): FirstTurnView => ({
  realGame: true,
  turn: 1,
  myTurn: true,
  phase: 'draft',
  briefingOpen: false,
  ownTerritoryOpen: false,
  draftLeft: 3,
  ...o,
});
const none = new Set<FirstTurnStep>();

describe('newFirstTurnSteps', () => {
  it('records closing the start briefing, whoever is to move', () => {
    expect(newFirstTurnSteps(view({ briefingOpen: true, myTurn: false }), view({ myTurn: false }), none)).toEqual(['briefing_closed']);
  });

  it('records opening a territory of theirs while placing reinforcements', () => {
    expect(newFirstTurnSteps(view(), view({ ownTerritoryOpen: true }), none)).toEqual(['territory_opened']);
  });

  it('records placing units, the first time the count goes down', () => {
    expect(newFirstTurnSteps(view({ ownTerritoryOpen: true }), view({ ownTerritoryOpen: true, draftLeft: 2 }), none))
      .toEqual(['territory_opened', 'units_placed']);
  });

  it('records ending reinforcements when the turn goes on into its attack', () => {
    expect(newFirstTurnSteps(view({ draftLeft: 0 }), view({ phase: 'attack', draftLeft: 0 }), none)).toEqual(['draft_ended']);
  });

  it('does not count the turn passing on, as when the clock runs out', () => {
    expect(newFirstTurnSteps(view(), view({ myTurn: false, phase: 'draft' }), none)).toEqual([]);
  });

  it('sends each step once a game', () => {
    const sent = new Set<FirstTurnStep>(['territory_opened']);
    expect(newFirstTurnSteps(view(), view({ ownTerritoryOpen: true }), sent)).toEqual([]);
  });

  it('records nothing in the tutorial, after the first round, or for a later join', () => {
    expect(newFirstTurnSteps(view(), view({ realGame: false, ownTerritoryOpen: true }), none)).toEqual([]);
    expect(newFirstTurnSteps(view({ turn: 2 }), view({ turn: 2, ownTerritoryOpen: true }), none)).toEqual([]);
    expect(newFirstTurnSteps(null, view({ draftLeft: 0 }), none)).toEqual([]);
  });

  it('does not take an opponent\'s turn, or a territory looked at off-turn, as the player\'s', () => {
    expect(newFirstTurnSteps(view({ myTurn: false }), view({ myTurn: false, ownTerritoryOpen: true, draftLeft: 1 }), none)).toEqual([]);
  });
});

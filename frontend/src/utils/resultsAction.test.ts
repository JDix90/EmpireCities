import { describe, it, expect } from 'vitest';
import { resultsActionProperties } from './resultsAction';

describe('resultsActionProperties', () => {
  it('names the action, the outcome and the game, as strings', () => {
    expect(resultsActionProperties('rematch', {
      gameId: 'g1', isWinner: false, firstMatch: true, isTutorial: false, isGuest: true,
    })).toEqual({
      action: 'rematch', outcome: 'lost', game_id: 'g1', first_match: 'true', is_tutorial: 'false', is_guest: 'true',
    });
    expect(resultsActionProperties('share', {
      isWinner: true, firstMatch: false, isTutorial: false, isGuest: false,
    })).toMatchObject({ action: 'share', outcome: 'won', game_id: '' });
  });
});

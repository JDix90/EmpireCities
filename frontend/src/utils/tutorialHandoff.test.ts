import { describe, it, expect, beforeEach } from 'vitest';
import { isTutorialHandoffGame, markTutorialHandoff, tutorialHandoffGoalLine } from './tutorialHandoff';
import { POST_TUTORIAL_MATCH_PATH } from './firstMatch';
import { TUTORIAL_HANDOFF_PARAM, TUTORIAL_HANDOFF_VALUE } from './tutorialHandoff';

describe('tutorialHandoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('the tutorial\'s route carries the marker the lobby reads; the ladder\'s does not', () => {
    const tutorial = new URL(POST_TUTORIAL_MATCH_PATH, 'http://x');
    expect(tutorial.pathname).toBe('/lobby');
    expect(tutorial.searchParams.get('play')).toBe('quick');
    expect(tutorial.searchParams.get(TUTORIAL_HANDOFF_PARAM)).toBe(TUTORIAL_HANDOFF_VALUE);
    // GamePage's Next battle.
    expect(new URL('/lobby?play=quick', 'http://x').searchParams.get(TUTORIAL_HANDOFF_PARAM)).toBeNull();
  });

  it('knows only the one match it was told about', () => {
    expect(isTutorialHandoffGame('g1')).toBe(false);
    markTutorialHandoff('g1');
    expect(isTutorialHandoffGame('g1')).toBe(true);
    expect(isTutorialHandoffGame('g2')).toBe(false);
    expect(isTutorialHandoffGame(undefined)).toBe(false);
    expect(isTutorialHandoffGame('')).toBe(false);
    // A later hand-off replaces it.
    markTutorialHandoff('g2');
    expect(isTutorialHandoffGame('g1')).toBe(false);
    expect(isTutorialHandoffGame('g2')).toBe(true);
  });

  it('says the goal as a count of territories, from the map-control progress', () => {
    expect(
      tutorialHandoffGoalLine({ held: 7, total: 14, heldPct: 50, thresholdPct: 65, needed: 10, remaining: 3 }),
    ).toBe('Hold 10 of the 14 territories to win. You have 7. Your move.');
  });

  it('falls back to every territory in a game with no map-control win', () => {
    expect(tutorialHandoffGoalLine(null)).toBe('Take every territory to win. Your move.');
  });
});

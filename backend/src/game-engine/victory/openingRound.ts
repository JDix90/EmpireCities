import type { GameState } from '../../types';

/**
 * Whether the alternative victory conditions are live yet.
 *
 * `turn_number` is the round: it moves to 2 when the hand-off crosses the
 * starting seat (advanceToNextPlayer), i.e. once every seat has finished a
 * turn. Capital, threshold, missions and the rest wait for that. A capital
 * with its 3 starting units can fall to the first seat's dice before the last
 * seat has placed a unit: an AI took a human's 2-unit capital on its own first
 * turn and the game ended, rated, with the human never having acted.
 *
 * Domination and last standing stay immediate: every rival is gone either way.
 * From round 2 every condition is live, and turn passing checks victory, so a
 * first-round capture that still holds ends the game at the hand-off into
 * round 2 rather than never.
 *
 * Daily puzzles judge their own objectives on their own clock and are exempt.
 */
export function alternativeVictoriesLive(state: GameState): boolean {
  if (state.settings.daily_challenge_date) return true;
  return state.turn_number >= 2;
}

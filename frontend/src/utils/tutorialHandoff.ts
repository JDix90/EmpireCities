/**
 * The tutorial's hand-off to a real match (`tutorial_handoff_enabled`).
 *
 * The tutorial's wrap-up sends a player to `/lobby?play=quick&from=tutorial`
 * (POST_TUTORIAL_MATCH_PATH), where the lobby starts their Quick Match: the
 * first match for a newcomer. 85% of first matches start that way, and seven
 * in eight of those were never finished, most of them left in round 1. The
 * player has just finished a nine-card lesson, and the match opened on one
 * more card, "The battle begins", with a question to answer before the board.
 *
 * The lobby notes the match it starts from there, for this tab only, and with
 * the flag on that match opens on the board: no briefing, tips on (the
 * briefing's main button), and the goal in one line until the player opens
 * one of their territories. The note is made whatever the flag says, so a lobby that arrives
 * before the flags have loaded cannot lose it; GamePage reads the flag. The
 * ladder's Next battle reaches the same lobby route without `from=tutorial`,
 * and keeps its briefing.
 */
import type { MapControlProgress } from './mapControl';

/** The query parameter, and its value, that say a lobby visit came from the tutorial. */
export const TUTORIAL_HANDOFF_PARAM = 'from';
export const TUTORIAL_HANDOFF_VALUE = 'tutorial';

const HANDOFF_KEY = 'cc-tutorial-handoff';

/** Note that `gameId` is the match the tutorial handed this tab to. */
export function markTutorialHandoff(gameId: string): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, gameId);
  } catch {
    /* storage unavailable: the match opens with its briefing, as before */
  }
}

/** Whether `gameId` is the match the tutorial handed this tab to. */
export function isTutorialHandoffGame(gameId: string | null | undefined): boolean {
  if (!gameId) return false;
  try {
    return sessionStorage.getItem(HANDOFF_KEY) === gameId;
  } catch {
    return false;
  }
}

/**
 * The goal, in the one line the briefing's "How to win" becomes: the share of
 * the map to hold as a count of territories, read from the same progress the
 * map-control tracker shows, or "every territory" in a game won only that way.
 */
export function tutorialHandoffGoalLine(progress: MapControlProgress | null): string {
  if (!progress) return 'Take every territory to win. Your move.';
  return `Hold ${progress.needed} of the ${progress.total} territories to win. You have ${progress.held}. Your move.`;
}

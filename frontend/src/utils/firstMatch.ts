import type { QuickMatchPrefs } from './quickMatchPrefs';

/**
 * A player's first Quick Match, while `first_match_easy_enabled` is on: one
 * Easy bot on Great Britain 925 under the default Conquest ending, instead of
 * the saved setup on a random era.
 *
 * backend/scripts/simFirstMatch.ts chose it. Against one Easy bot on this
 * 14-territory map, a newcomer's game ran about 6 to 10 minutes at the median
 * (at 45 seconds a turn), and they won about half the time when barely
 * attacking and three in four when attacking with purpose. More Easy bots did
 * not make it harder, they made it stall: with two or three, a third to nearly
 * three quarters of games ran to the 60-round cap.
 */
export const FIRST_MATCH_ERA_ID = 'medieval';
export const FIRST_MATCH_MAP_ID = 'community_britain_925';
export const FIRST_MATCH_PREFS: QuickMatchPrefs = { aiCount: 1, aiDifficulty: 'easy', victory: 'majority' };

/** The Quick Match button's second line while the next match is the first. */
export const FIRST_MATCH_BUTTON_LINE = 'First match · vs 1 Easy AI · Great Britain';
/** The welcome screen and new-player card's Quick Match line while the next match is the first. */
export const FIRST_MATCH_CARD_LINE = 'One Easy opponent on a small map of Britain — a short first match. Start now.';

/**
 * Whether the player has yet to finish a game, read from GET /users/me/stats
 * (finished, non-tutorial games). Null when the response is not readable.
 */
export function firstMatchPendingFromStats(stats: unknown): boolean | null {
  const played = (stats as { overall?: { played?: unknown } } | null | undefined)?.overall?.played;
  return typeof played === 'number' ? played === 0 : null;
}

/**
 * Whether the next Quick Match should be the first match. A player who has set
 * up Quick Match themselves keeps their own choice; anything unreadable falls
 * back to the ordinary Quick Match rather than guessing.
 */
export async function fetchFirstMatchPending(
  get: (url: string) => Promise<{ data: unknown }>,
  hasOwnSetup: boolean,
): Promise<boolean> {
  if (hasOwnSetup) return false;
  try {
    return firstMatchPendingFromStats((await get('/users/me/stats')).data) === true;
  } catch {
    return false;
  }
}

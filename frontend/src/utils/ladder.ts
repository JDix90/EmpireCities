import type { QuickMatchPrefs } from './quickMatchPrefs';

/**
 * The first-win ladder (`first_match_ladder_enabled`): the stopgap for the
 * review's ladder of battles. Until a player's first win, Quick Match is the
 * first match (one Easy bot on Britain, utils/firstMatch.ts); after it, one
 * Medium bot on Britain until their second; then the ordinary Quick Match. The
 * results screen of a ladder game offers the next battle, and Full Game stays
 * the second choice in the lobby until the ladder is done.
 *
 * Before it, one finished game — won or lost — made the lobby's gold button
 * the Full Game (three Medium bots, every system on, which ran to its round cap
 * in every simulated game), and a player who had just lost to one Easy bot was
 * offered that.
 *
 * Rung 2 was chosen with bots on the first-match map, 400 games per row: a
 * newcomer playing like the Easy bot wins 53.5% against one Easy bot, 33.8%
 * against one Medium, 11% against two Easy (and those games run three times as
 * long), 26.5% against one Easy on the Medieval world map. One Medium on the
 * board they know is the step up that stays short.
 */
export type LadderRung = 1 | 2;

export const LADDER_RUNG_2_ERA_ID = 'medieval';
export const LADDER_RUNG_2_MAP_ID = 'community_britain_925';
export const LADDER_RUNG_2_PREFS: QuickMatchPrefs = { aiCount: 1, aiDifficulty: 'medium', victory: 'majority' };

/** The Quick Match button's second line on rung 2. */
export const LADDER_RUNG_2_BUTTON_LINE = 'Battle 2 · vs 1 Medium AI · Great Britain';
/** The welcome screen and new-player card's Quick Match line on rung 2. */
export const LADDER_RUNG_2_CARD_LINE = 'One Medium opponent on Britain — a step up from your first win.';

/**
 * The rung a player is on, read from GET /users/me/stats (finished games that
 * are not the tutorial): no win yet is rung 1, one win rung 2, more is past
 * the ladder (null). Undefined when the response is not readable.
 */
export function ladderRungFromStats(stats: unknown): LadderRung | null | undefined {
  const won = (stats as { overall?: { won?: unknown } } | null | undefined)?.overall?.won;
  if (typeof won !== 'number') return undefined;
  if (won <= 0) return 1;
  if (won === 1) return 2;
  return null;
}

/**
 * The rung the next Quick Match is built for. A player who has set up Quick
 * Match themselves keeps their own choice; anything unreadable falls back to
 * the ordinary Quick Match rather than guessing.
 */
export async function fetchLadderRung(
  get: (url: string) => Promise<{ data: unknown }>,
  hasOwnSetup: boolean,
): Promise<LadderRung | null> {
  if (hasOwnSetup) return null;
  try {
    return ladderRungFromStats((await get('/users/me/stats')).data) ?? null;
  } catch {
    return null;
  }
}

/**
 * What the results screen's ladder button says (`next_battle`): the same
 * battle again after a loss, the next one after a win. It always leads to the
 * lobby's next Quick Match, which the rung decides.
 */
export function nextBattleLabel(won: boolean): string {
  return won ? 'Next battle' : 'Try again';
}

/** Whether a finished game was one of the ladder's, so its results offer the next battle. */
export function isLadderGame(settings: { first_match?: boolean; ladder_step?: number } | null | undefined): boolean {
  return settings?.first_match === true || settings?.ladder_step === 1 || settings?.ladder_step === 2;
}

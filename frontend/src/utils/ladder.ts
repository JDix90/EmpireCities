import type { QuickMatchPrefs } from './quickMatchPrefs';
import { fetchFirstMatchPending } from './firstMatch';

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
 *
 * The map ladder (`first_match_ladder_maps_enabled`) grows the board, then
 * the bot, one win at a time: Britain (14 territories), Balkanized Spain
 * (24), Fractured China (30) and Sengoku Japan (38) against one Easy bot,
 * then the Medieval world map (36) against one Medium bot and then two,
 * before the ordinary Quick Match (three Medium bots on a world map of 36 to
 * 57). One thing changes per battle. backend/scripts/simFirstMatch.ts, 400 games per
 * row, the newcomer barely attacking / attacking with purpose:
 *
 *   1 Britain, 1 Easy (first match):  wins 56% / 92%,  median 12.6 / 3.9 min
 *   2 Spain, 1 Easy:                  wins 48% / 98%,  median 11.9 / 3.9 min
 *   3 China, 1 Easy:                  wins 48% / 100%, median 17.4 / 3.9 min
 *   4 Japan, 1 Easy:                  wins 40% / 95%,  median 22.2 / 5.5 min
 *   5 Medieval world, 1 Medium:       wins  7% / 42%,  median  4.9 / 5.5 min
 *   6 Medieval world, 2 Medium:       wins  3% / 23%,  median 16.6 / 19.0 min
 *   then a world map, 3 Medium:       wins 0-3% / 15-19%, median 18-38 min
 *
 * A Medium bot on the regional boards would make two steps at once (China
 * 1% / 46%, Japan 0% / 43%); two Easy bots stall (the 60-round cap in 57% of
 * games on China, 77% on Japan). One Easy bot on the Medieval world map
 * stalls too (cap in 53% of a passive newcomer's games): one Medium is the
 * step from Easy. Two Medium bots on the board the player just won keep the
 * last step to one change; on the other world maps they ran 18-22% (WW2,
 * Cold War, Modern), and on Discovery stalled at the cap in half the games.
 */
export type LadderRung = 1 | 2 | 3 | 4 | 5 | 6;

export const LADDER_RUNG_2_ERA_ID = 'medieval';
export const LADDER_RUNG_2_MAP_ID = 'community_britain_925';
export const LADDER_RUNG_2_PREFS: QuickMatchPrefs = { aiCount: 1, aiDifficulty: 'medium', victory: 'majority' };

/** The Quick Match button's second line on rung 2. */
export const LADDER_RUNG_2_BUTTON_LINE = 'Battle 2 · vs 1 Medium AI · Great Britain';
/** The welcome screen and new-player card's Quick Match line on rung 2. */
export const LADDER_RUNG_2_CARD_LINE = 'One Medium opponent on Britain — a step up from your first win.';

/** A battle of the ladder after the first match: what the lobby's Quick Match starts, and how it says so. */
export interface LadderBattle {
  /** The game's `ladder_step`. */
  step: 2 | 3 | 4 | 5 | 6;
  eraId: string;
  mapId: string;
  prefs: QuickMatchPrefs;
  /** The Quick Match button's second line. */
  buttonLine: string;
  /** The welcome screen and new-player card's Quick Match line. */
  cardLine: string;
}

/** Rung 2 without the map ladder: one Medium bot on Britain. */
export const LADDER_RUNG_2_BATTLE: LadderBattle = {
  step: 2,
  eraId: LADDER_RUNG_2_ERA_ID,
  mapId: LADDER_RUNG_2_MAP_ID,
  prefs: LADDER_RUNG_2_PREFS,
  buttonLine: LADDER_RUNG_2_BUTTON_LINE,
  cardLine: LADDER_RUNG_2_CARD_LINE,
};

/** One Easy bot, the 65% ending: the first match's table, on a bigger board. */
const ONE_EASY_BOT: QuickMatchPrefs = { aiCount: 1, aiDifficulty: 'easy', victory: 'majority' };
/** One Medium bot, the 65% ending: the step from Easy toward the ordinary Quick Match's three. */
const ONE_MEDIUM_BOT: QuickMatchPrefs = { aiCount: 1, aiDifficulty: 'medium', victory: 'majority' };
/** Two Medium bots: the last step before the ordinary Quick Match's three. */
const TWO_MEDIUM_BOTS: QuickMatchPrefs = { aiCount: 2, aiDifficulty: 'medium', victory: 'majority' };

/** The map ladder's last rung: past it, the ordinary Quick Match. POST /api/games accepts `ladder_step` up to it. */
export const LADDER_MAPS_LAST_RUNG = 6;

/**
 * The map ladder's battles (`first_match_ladder_maps_enabled`), each under the
 * rules era its map recommends (lobbyEraMapCompatibility.ts).
 */
export const LADDER_MAP_BATTLES: Record<2 | 3 | 4 | 5 | 6, LadderBattle> = {
  2: {
    step: 2,
    eraId: 'modern',
    mapId: 'community_balkanized_spain',
    prefs: ONE_EASY_BOT,
    buttonLine: 'Battle 2 · vs 1 Easy AI · Balkanized Spain',
    cardLine: 'One Easy opponent across a Spain split into rival crowns — 24 territories, a step up from Britain.',
  },
  3: {
    step: 3,
    eraId: 'modern',
    mapId: 'community_fractured_china',
    prefs: ONE_EASY_BOT,
    buttonLine: 'Battle 3 · vs 1 Easy AI · Fractured China',
    cardLine: 'One Easy opponent on warlord-era China — a bigger map, 30 territories.',
  },
  4: {
    step: 4,
    eraId: 'medieval',
    mapId: 'community_sengoku_japan',
    prefs: ONE_EASY_BOT,
    buttonLine: 'Battle 4 · vs 1 Easy AI · Sengoku Japan',
    cardLine: 'One Easy opponent across Sengoku Japan — 38 provinces, as big as a world map.',
  },
  5: {
    step: 5,
    eraId: 'medieval',
    mapId: 'era_medieval',
    prefs: ONE_MEDIUM_BOT,
    buttonLine: 'Battle 5 · vs 1 Medium AI · Medieval world',
    cardLine: 'Your first world map, against one Medium opponent.',
  },
  6: {
    step: 6,
    eraId: 'medieval',
    mapId: 'era_medieval',
    prefs: TWO_MEDIUM_BOTS,
    buttonLine: 'Battle 6 · vs 2 Medium AI · Medieval world',
    cardLine: 'Two Medium opponents on the world you just won — the last battle before the full Quick Match.',
  },
};

/** The battle a rung past the first starts, or null when the ladder has none (rung 1 is the first match). */
export function ladderBattle(rung: LadderRung | null | undefined, maps: boolean): LadderBattle | null {
  if (rung === 2 && !maps) return LADDER_RUNG_2_BATTLE;
  if (maps && (rung === 2 || rung === 3 || rung === 4 || rung === 5 || rung === 6)) return LADDER_MAP_BATTLES[rung];
  return null;
}

/**
 * The rung a player is on, read from GET /users/me/stats (finished games that
 * are not the tutorial): no win yet is rung 1, one win rung 2; with the map
 * ladder, each further win a rung up to rung 6 (five wins). Past the ladder is
 * null. Undefined when the response is not readable.
 */
export function ladderRungFromStats(stats: unknown, maps = false): LadderRung | null | undefined {
  const won = (stats as { overall?: { won?: unknown } } | null | undefined)?.overall?.won;
  if (typeof won !== 'number') return undefined;
  if (won <= 0) return 1;
  const rung = Math.floor(won) + 1;
  if (rung > (maps ? LADDER_MAPS_LAST_RUNG : 2)) return null;
  return rung as LadderRung;
}

/**
 * The rung the next Quick Match is built for. A player who has set up Quick
 * Match themselves keeps their own choice; anything unreadable falls back to
 * the ordinary Quick Match rather than guessing.
 */
export async function fetchLadderRung(
  get: (url: string) => Promise<{ data: unknown }>,
  hasOwnSetup: boolean,
  maps = false,
): Promise<LadderRung | null> {
  if (hasOwnSetup) return null;
  try {
    return ladderRungFromStats((await get('/users/me/stats')).data, maps) ?? null;
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
  const step = settings?.ladder_step;
  return settings?.first_match === true
    || (typeof step === 'number' && Number.isInteger(step) && step >= 1 && step <= LADDER_MAPS_LAST_RUNG);
}

/**
 * What the lobby's next Quick Match is: the first match (no win yet), a later
 * battle of the ladder, or the player's own Quick Match (past the ladder, or
 * set up themselves). The button that starts it is named for it, in the lobby
 * and on the tutorial's last card, which sends the player there: an account
 * that has played before read "Play your first match" and got its own Quick
 * Match on a random world map.
 */
export type NextMatchKind = 'first' | 'ladder' | 'quick';

export function nextMatchKind(
  firstMatchPending: boolean | null | undefined,
  ladderNext: LadderBattle | null | undefined,
): NextMatchKind {
  if (firstMatchPending) return 'first';
  if (ladderNext) return 'ladder';
  return 'quick';
}

/** The lobby button's title for each. "Next battle" is the results screen's word for the same match. */
export const NEXT_MATCH_TITLES: Record<NextMatchKind, string> = {
  first: 'First Match',
  ladder: 'Next Battle',
  quick: 'Quick Match',
};

/**
 * The lobby's next Quick Match, read as the lobby reads it when it starts one
 * (LobbyPage startQuickMatch): the flags, the player's own setup, then the
 * stats. Anything unreadable is the ordinary Quick Match, as there.
 */
export async function fetchNextMatchKind(
  get: (url: string) => Promise<{ data: unknown }>,
  hasOwnSetup: boolean,
  flags: { firstMatchEasy: boolean; ladder: boolean; ladderMaps: boolean },
): Promise<NextMatchKind> {
  if (!flags.firstMatchEasy) return 'quick';
  if (flags.ladder) {
    const rung = await fetchLadderRung(get, hasOwnSetup, flags.ladderMaps);
    return nextMatchKind(rung === 1, ladderBattle(rung, flags.ladderMaps));
  }
  return (await fetchFirstMatchPending(get, hasOwnSetup)) ? 'first' : 'quick';
}

import { queryOne } from '../../db/postgres';
import { andNotTutorialSql } from '../../game-engine/tutorial/tutorialGames';

/**
 * True for a campaign stage's game; `g` is the `games` row. The first match
 * and the first-win ladder leave these out: a campaign is its own
 * progression, and a stage won is not the first win the ladder waits for.
 */
export const IS_CAMPAIGN_GAME_SQL = `COALESCE(g.settings_json->>'is_campaign', 'false') = 'true'`;

/**
 * Whether a player may tag a new game `first_match` (`first_match_fair_start_enabled`).
 *
 * The lobby sends the tag while the player has yet to finish a game (client
 * utils/firstMatch.ts, read from GET /users/me/stats). Once the tag also seats
 * the player first and deals them a fair board, it is worth faking: solo games
 * move the Solo rating. So the server counts the same thing the lobby does —
 * finished games that are not the tutorial, a Play On or a campaign stage —
 * and drops the tag from anyone who has one.
 */
export async function hasFinishedRealGame(userId: string): Promise<boolean> {
  const row = await queryOne<{ finished: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND g.status = 'completed'
         ${andNotTutorialSql()}
         AND NOT ${IS_CAMPAIGN_GAME_SQL}
     ) AS finished`,
    [userId],
  );
  return row?.finished === true;
}

/**
 * With the first-win ladder (`first_match_ladder_enabled`) the first match is
 * offered until the player's first win, not their first finished game, so the
 * tag is kept on the same terms: no won game that is not the tutorial or a
 * Play On. A win is `final_rank = 1`, as GET /users/me/stats counts it.
 */
export async function hasWonRealGame(userId: string): Promise<boolean> {
  const row = await queryOne<{ won: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND g.status = 'completed' AND gp.final_rank = 1
         ${andNotTutorialSql()}
         AND NOT ${IS_CAMPAIGN_GAME_SQL}
     ) AS won`,
    [userId],
  );
  return row?.won === true;
}

/** The tag a new game keeps: dropped once the player is past the first match. */
export function eligibleFirstMatchTag(requested: true | undefined, hasFinished: boolean): true | undefined {
  return requested === true && !hasFinished ? true : undefined;
}

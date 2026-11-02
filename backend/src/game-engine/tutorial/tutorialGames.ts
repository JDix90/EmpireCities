/**
 * The tutorial is a lesson, not a match on your record.
 *
 * A tutorial runs as a real game: `POST /games/tutorial/start` inserts a
 * `games` row, and `finalizeGame` marks it `completed` and writes
 * `game_players.final_rank` exactly like any other. Nothing downstream can tell
 * the difference except `settings_json.tutorial`, so every query that counts a
 * player's games has to say so explicitly — and the ones that forgot were
 * counting tutorials towards "Games Played", win rate, win streak, the Veteran
 * achievement, the leaderboards and the referral reward.
 *
 * That matters more than a stray +1: the tutorial bot never attacks
 * (`aiBot.ts`), so a finished tutorial is a guaranteed win against a passive
 * opponent — free wins in every rate and streak it reached.
 *
 * `GET /users/me/games` (match history) already filtered this way; this is the
 * same predicate, named once so the rest can stop drifting from it.
 */

/**
 * SQL predicate selecting rows of `games` that are NOT tutorial games.
 *
 * `alias` is the table alias in the caller's FROM (`g` by convention here). A
 * NULL `settings_json` counts as a real game, which is what the COALESCE is
 * for — older rows predate the column being populated.
 */
export function notTutorialSql(alias = 'g'): string {
  return `COALESCE(${alias}.settings_json ->> 'tutorial', 'false') <> 'true'`;
}

/**
 * SQL predicate selecting rows of `games` that are NOT a play-on continuation
 * (game-engine/victory/playOn.ts): the game a table kept playing after it was
 * won. The win is on the record already, so the continuation is not a second
 * game played, and losing it is not a loss.
 */
export function notPlayOnSql(alias = 'g'): string {
  return `${alias}.settings_json ->> 'play_on_of' IS NULL`;
}

/**
 * The same predicates as an `AND` clause, for appending to an existing WHERE:
 * a game on the player's record is neither a tutorial nor a play-on
 * continuation.
 */
export function andNotTutorialSql(alias = 'g'): string {
  return `AND ${notTutorialSql(alias)} AND ${notPlayOnSql(alias)}`;
}

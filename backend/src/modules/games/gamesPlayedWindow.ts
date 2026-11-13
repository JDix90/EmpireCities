/**
 * The games the lobby's "N games played in the last 24 hours" counts
 * (GET /api/games/stats/activity): every game started or finished in that
 * time, finished or not. Tutorials, games left part-way and games still going
 * count: each is a game someone played. A lobby that never started does not
 * (`started_at` is set only when a game starts, or at creation for a Play On
 * continuation).
 *
 * A rolling window rather than "since midnight", so the number does not reset
 * to almost nothing each night. It also falls as games age out, which is why
 * the lobby says "in the last 24 hours" rather than "today": "today" read as a
 * number that shrank for no reason. `alias` is the `games` row's alias.
 */
export function playedInLast24HoursSql(alias: string): string {
  return `${alias}.started_at IS NOT NULL
              AND (${alias}.started_at >= NOW() - INTERVAL '24 hours'
                   OR ${alias}.ended_at >= NOW() - INTERVAL '24 hours')`;
}

/**
 * The games the lobby's "N games played so far" counts
 * (`early_access_count_enabled`, GET /api/games/stats/activity's
 * `games_played_total`): every game that started and is over, finished or
 * left part-way, tutorials included. A lobby that never started does not count,
 * nor does a game still going until it ends.
 *
 * Only ever goes up: game clean-up (gameCleanupService.ts) deletes only games
 * still waiting or in progress, and a game's status never leaves completed or
 * abandoned. `alias` is the `games` row's alias.
 */
export function playedAllTimeSql(alias: string): string {
  return `${alias}.started_at IS NOT NULL
              AND ${alias}.status IN ('completed', 'abandoned')`;
}

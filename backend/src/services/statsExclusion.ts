/**
 * Who the admin stats leave out: admin accounts, and accounts an admin marked
 * as test accounts (`users.exclude_from_stats`, migration 049). The operator
 * plays far more than anyone else, so their own games otherwise dominate every
 * count on the Overview, Analytics and Balance tabs.
 *
 * Each helper returns a SQL predicate to AND into a query. They read the
 * columns live, so marking an account changes the stats at once, history
 * included.
 */

/** True for an account the stats leave out. `alias` is a `users` row. */
export function excludedUserSql(alias: string): string {
  return `(COALESCE(${alias}.is_admin, false) OR COALESCE(${alias}.exclude_from_stats, false))`;
}

/**
 * A game counts unless everyone who played it is left out. A game with one
 * real player in it counts, so a session with friends stays in; a game with no
 * linked account at all (a deleted one) counts as it always did. `gameAlias` is
 * a `games` row.
 */
export function countedGameSql(gameAlias: string): string {
  const anyPlayer = (where: string) =>
    `EXISTS (SELECT 1 FROM game_players sx_gp JOIN users sx_u ON sx_u.user_id = sx_gp.user_id
             WHERE sx_gp.game_id = ${gameAlias}.game_id AND ${where})`;
  return `(NOT ${anyPlayer(excludedUserSql('sx_u'))} OR ${anyPlayer(`NOT ${excludedUserSql('sx_u')}`)})`;
}

/**
 * An analytics event counts unless a left-out account recorded it. Anonymous
 * events (no user) always count. `eventAlias` is an `analytics_events` row.
 */
export function countedEventSql(eventAlias: string): string {
  return `NOT EXISTS (SELECT 1 FROM users sx_eu WHERE sx_eu.user_id = ${eventAlias}.user_id AND ${excludedUserSql('sx_eu')})`;
}

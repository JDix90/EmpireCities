/**
 * The daily leaderboard's one ordering, shared by the live board, the rank
 * query and the archive so the number a player sees beside their result is
 * the row they occupy on the board.
 *
 * A v1 day ranks won, then score, then turns, then territories — exactly as
 * before. A v2 day (docs/DAILY_PUZZLE_V2.md §4) ranks score (accuracy), then
 * first-try, then attempts, then completion time; `won` is shown, never
 * ranked, because the dice decide it and accuracy is what the player controls.
 * One expression serves both because the rows of one date are all one
 * version (the same spec is served to everyone), and the v2 columns are NULL
 * on v1 rows, which sorts them last and leaves the v1 order untouched.
 *
 * The table alias is `dce`.
 */
export const DAILY_LEADERBOARD_ORDER_BY = `
  (dce.won AND COALESCE(dce.puzzle_version, 1) < 2) DESC,
  dce.puzzle_score DESC NULLS LAST,
  dce.first_try DESC NULLS LAST,
  dce.attempts ASC NULLS LAST,
  CASE WHEN COALESCE(dce.puzzle_version, 1) >= 2 THEN dce.completed_at END ASC NULLS LAST,
  dce.turn_count ASC NULLS LAST,
  dce.territory_count DESC NULLS LAST`;

/** The entry columns every board shows, v2 ones included. */
export const DAILY_LEADERBOARD_COLUMNS = `dce.won, dce.puzzle_score, dce.turn_count, dce.territory_count,
  COALESCE(dce.puzzle_version, 1)::int AS puzzle_version, dce.accuracy::float AS accuracy, dce.first_try, dce.attempts`;

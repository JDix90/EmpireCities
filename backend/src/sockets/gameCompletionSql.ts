/**
 * Mark a game completed: once, and never over an abandoned game.
 *
 * finalizeGame can be entered more than once for the same game (a resign
 * victory check racing the turn timer's, a daily objective settling on the
 * turn a conquest ends the game). Only the call that moves the row pays out:
 * when this matches no row, finalizeGame skips everything that follows —
 * ratings, XP, streaks, achievements, the campaign hook.
 *
 * An abandoned game is finished as well, and it awards nothing. The resign
 * grace window, POST /games/:id/abandon, a campaign restart and the stale-game
 * sweep all mark a game 'abandoned' for exactly that reason, while its room can
 * still hold a live board: a bot turn queued before the resign used to play it
 * out, reach finalizeGame and turn the abandoned game into a completed loss.
 *
 * $1 winner_id (NULL for a bot: bot ids are not users), $2 game_id.
 */
export const MARK_GAME_COMPLETED_SQL = `
  UPDATE games SET status = 'completed', ended_at = NOW(), winner_id = $1
  WHERE game_id = $2 AND status NOT IN ('completed', 'abandoned')`;

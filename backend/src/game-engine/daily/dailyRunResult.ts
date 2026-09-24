import { queryOne } from '../../db/postgres';

/**
 * Whether a daily game's run was won, read from its player's entry. Null for
 * any other game, and for a daily game whose run has no entry yet.
 *
 * The game's own winner is not the run's result: an objective day can end
 * with its player holding the board and the challenge lost (every rival fell
 * before the goal was met). A screen that names the winner of a daily game
 * reads this beside `games.winner_id`.
 *
 * The entry is matched on the player and the day. A player has one attempt
 * per day, so that pair is one run. Both dates are compared as `::date`, as
 * the daily routes do: the setting holds a JSON-stringified timestamp.
 */
export async function dailyRunWonForGame(gameId: string): Promise<boolean | null> {
  const row = await queryOne<{ won: boolean }>(
    `SELECT dce.won
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id AND gp.is_ai = false
       JOIN daily_challenge_entries dce
         ON dce.user_id = gp.user_id
        AND dce.challenge_date = (g.settings_json->>'daily_challenge_date')::date
      WHERE g.game_id = $1
      LIMIT 1`,
    [gameId],
  );
  return row ? row.won : null;
}

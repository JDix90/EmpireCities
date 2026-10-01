/**
 * Admin → Galactic Age: record the finished Galactic Age games the report has
 * no record of (POST /api/admin/actions/galaxy-backfill), from each game's final
 * saved board.
 *
 * Those are the games that ended before the report recorded games, or whose
 * record failed to write as they ended (finalizeGame records it non-critically).
 * A finished game's state snapshots are pruned GAME_STATE_RETENTION_DAYS after
 * it ends: until then its last snapshot is the game-over board finalizeGame
 * saved, and the record is the one finalizeGame would have written. Past that
 * the board is gone, and the game stays counted, not described.
 */
import { query } from '../../db/postgres';
import { recordGalaxyGameResult } from '../../game-engine/state/galaxyResults';
import type { GameState } from '../../types';
import { GALACTIC_AGE_GAME_SQL } from '../games/lobbyCapacity';

/** Finished Galactic Age games with no record, for table alias `g` (as the report counts them). */
export const UNRECORDED_GALAXY_GAMES_SQL = `
  g.status = 'completed'
  AND ${GALACTIC_AGE_GAME_SQL}
  AND COALESCE((g.settings_json->>'era_advancement_enabled')::boolean, false) = false
  AND NOT EXISTS (SELECT 1 FROM galaxy_game_results r WHERE r.game_id = g.game_id)`;

/**
 * The game's (alias `g`) last saved board is still its game-over board, the one
 * finalizeGame saved as it ended: what a backfill records it from. The report
 * counts these as recoverable. The last snapshot is picked by id first, so only
 * its board is read, not every turn's.
 */
export const GAME_OVER_BOARD_SAVED_SQL = `(
  SELECT last.state_json->>'phase' FROM game_states last
  WHERE last.id = (
    SELECT gs.id FROM game_states gs
    WHERE gs.game_id = g.game_id
    ORDER BY gs.turn_number DESC, gs.saved_at DESC
    LIMIT 1
  )
) = 'game_over'`;

/**
 * Games one call reads at most. Each is a whole saved board, and the admin's
 * request has to answer well inside the client's 15s timeout.
 */
export const GALAXY_BACKFILL_BATCH = 50;

/** Why an unrecorded game could not be recorded. */
export type GalaxyBackfillSkip =
  /** Its snapshots were pruned while the backfill ran. */
  | 'no_saved_board'
  /** Its last snapshot is no longer the game-over board. */
  | 'not_finished'
  /** Its game-over board names no winner. */
  | 'no_winner'
  /** Recorded meanwhile, or not a Galactic Age board after all. */
  | 'not_recorded';

export interface GalaxyBackfillResult {
  /** Unrecorded games read, oldest first. */
  checked: number;
  recorded: number;
  skipped: Record<GalaxyBackfillSkip, number>;
  /** More games with a game-over board to record remain past this batch. */
  more: boolean;
}

/**
 * Record the unrecorded games whose game-over board is still saved, up to
 * `batch`, oldest first: theirs are the boards pruned soonest. Each game is read
 * and recorded on its own, so one bad board costs only that game. Safe to run
 * again: a recorded game is no longer a candidate.
 */
export async function backfillGalaxyResults(batch = GALAXY_BACKFILL_BATCH): Promise<GalaxyBackfillResult> {
  // ended_at as text: through a JS Date it would lose its microseconds.
  const games = await query<{ game_id: string; ended_at: string | null }>(
    `SELECT g.game_id, g.ended_at::text AS ended_at
     FROM games g
     WHERE ${UNRECORDED_GALAXY_GAMES_SQL}
       AND ${GAME_OVER_BOARD_SAVED_SQL}
     ORDER BY g.ended_at ASC NULLS LAST, g.game_id
     LIMIT $1`,
    [batch + 1],
  );
  const result: GalaxyBackfillResult = {
    checked: 0,
    recorded: 0,
    skipped: { no_saved_board: 0, not_finished: 0, no_winner: 0, not_recorded: 0 },
    more: games.length > batch,
  };
  for (const game of games.slice(0, batch)) {
    result.checked += 1;
    const [snapshot] = await query<{ state_json: GameState }>(
      `SELECT state_json FROM game_states
       WHERE game_id = $1
       ORDER BY turn_number DESC, saved_at DESC
       LIMIT 1`,
      [game.game_id],
    );
    const skip = (reason: GalaxyBackfillSkip) => { result.skipped[reason] += 1; };
    if (!snapshot) { skip('no_saved_board'); continue; }
    const state = snapshot.state_json;
    if (state.phase !== 'game_over') { skip('not_finished'); continue; }
    // A Galactic Age game is never a daily, so its credited winners are the
    // board's: a side that wins together is listed whole.
    const winners = state.winner_ids?.length ? state.winner_ids : state.winner_id ? [state.winner_id] : [];
    if (!winners.length) { skip('no_winner'); continue; }
    if (await recordGalaxyGameResult(game.game_id, state, winners, game.ended_at)) result.recorded += 1;
    else skip('not_recorded');
  }
  return result;
}

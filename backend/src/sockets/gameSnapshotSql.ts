/**
 * Save a snapshot, keeping one per turn plus the game's opening board.
 *
 * Every mutation schedules a backup (debounced by POSTGRES_DEBOUNCE_MS), and
 * each one used to be a fresh INSERT, so a turn left 4–5 full copies of the
 * state behind. Every copy carries the whole win-probability history, which
 * gains an entry each turn, so a game's rows grew with the square of its
 * length: production reached 58GB in this table and the nightly backup no
 * longer fit on the disk. The readers want one row per turn: recovery takes
 * the newest, and the replay, chronicle and post-match analysis step turn by
 * turn.
 *
 * So the statement that inserts a snapshot also deletes the earlier snapshots
 * of the same turn. A turn is the game's `turn_number`, which advances once
 * every player has moved, so the row kept is the board at the end of that
 * turn. The game's first snapshot is exempt, so a replay still
 * opens on the starting board. A data-modifying CTE's DELETE does not see the
 * row its INSERT adds, so the new snapshot always survives. Two saves racing
 * on one turn can leave a duplicate; the turn's next save removes it.
 */
export const SAVE_TURN_SNAPSHOT_SQL = `
  WITH saved AS (
    INSERT INTO game_states (game_id, turn_number, state_json)
    VALUES ($1, $2, $3)
    RETURNING id
  )
  DELETE FROM game_states earlier
  WHERE earlier.game_id = $1
    AND earlier.turn_number = $2
    AND earlier.id NOT IN (SELECT id FROM saved)
    AND earlier.id <> (
      SELECT opening.id FROM game_states opening
      WHERE opening.game_id = $1
      ORDER BY opening.saved_at ASC, opening.id ASC
      LIMIT 1
    )`;

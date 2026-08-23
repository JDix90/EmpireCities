import { query } from '../../db/postgres';
import { runExclusive, SWEEP_LOCK_TTL_MS } from '../../utils/singletonTask';

const ORPHANED_GAME_GRACE_PERIOD_MS = 4 * 60 * 60 * 1000;
const ORPHANED_GAME_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

// Keep per-turn replay snapshots for this long after a game ends, then prune.
// game_states is append-only (one row per turn per game) and was never pruned,
// so it grew unbounded — heavy on disk, backups, and the MAX(turn) subqueries.
const GAME_STATE_RETENTION_MS = Math.max(
  60 * 60 * 1000,
  (parseInt(process.env.GAME_STATE_RETENTION_DAYS || '30', 10) || 30) * 24 * 60 * 60 * 1000,
);
// Bound how many snapshot rows a single prune deletes, so the FIRST run on an
// existing (large) table drains over several ticks instead of one giant DELETE.
const SNAPSHOT_PRUNE_BATCH = 5000;

/**
 * Idle time after which a `waiting`/`in_progress` game is considered abandoned.
 *
 * This closes the gap that made snapshot retention ineffective: the prune below
 * only considers games in a TERMINAL status, but a game nobody finishes never
 * reaches one. On production that left 43 games holding 53,794 snapshot rows
 * (~35GB of TOASTed state_json, 98% of all snapshots) going back three months,
 * which the 30-day retention could not see at all.
 *
 * Safety margin: the longest selectable async turn deadline is 72h
 * (VALID_ASYNC_DEADLINES in game-engine/state/gameSettings.ts), so the 9-day
 * default is 3x the longest window in which a live game can legitimately sit
 * idle waiting on a player.
 */
const STALE_GAME_ABANDON_MS = Math.max(
  24 * 60 * 60 * 1000,
  (parseInt(process.env.STALE_GAME_ABANDON_DAYS || '9', 10) || 9) * 24 * 60 * 60 * 1000,
);
// Same batching rationale as SNAPSHOT_PRUNE_BATCH — bound the first sweep over
// an existing backlog.
const STALE_GAME_ABANDON_BATCH = 500;

/**
 * Last-activity expression for a game: newest snapshot, else start, else
 * creation. Shared by the orphan sweep and the staleness sweep so both agree on
 * what "untouched" means.
 */
const LAST_ACTIVITY_SQL = `COALESCE(
           (SELECT MAX(gs.saved_at) FROM game_states gs WHERE gs.game_id = candidate.game_id),
           candidate.started_at,
           candidate.created_at
         )`;

let orphanedGameSweepInterval: ReturnType<typeof setInterval> | null = null;

export async function deleteInactiveHumanlessGames(): Promise<string[]> {
  const result = await query<{ game_id: string }>(
    `DELETE FROM games g
     WHERE g.game_id IN (
       SELECT candidate.game_id
       FROM games candidate
       WHERE candidate.status IN ('waiting', 'in_progress')
         AND NOT EXISTS (
           SELECT 1
           FROM game_players gp
           WHERE gp.game_id = candidate.game_id
             AND gp.is_ai = false
         )
         AND ${LAST_ACTIVITY_SQL} <= NOW() - ($1 * INTERVAL '1 millisecond')
     )
     RETURNING g.game_id`,
    [ORPHANED_GAME_GRACE_PERIOD_MS],
  );

  return result.map((row) => row.game_id);
}

/**
 * Mark long-idle `waiting`/`in_progress` games as abandoned so snapshot
 * retention can reach them.
 *
 * `ended_at` is set to the game's LAST ACTIVITY, not NOW(). Two reasons:
 *   - It is honest: the game effectively ended when the player stopped playing.
 *   - deleteExpiredGameStateSnapshots() keys off COALESCE(ended_at, created_at),
 *     so back-dating means an existing backlog becomes eligible immediately
 *     rather than starting a fresh 30-day clock from the day we swept it.
 *
 * Deliberately does NOT touch ratings, XP or `winner_id` — an abandoned game
 * awards nothing, which matches how abandoned games already behave. Players see
 * these drop off "Your Active Games", whose query filters on
 * `status IN ('waiting', 'in_progress')`.
 */
export async function abandonStaleGames(): Promise<string[]> {
  const result = await query<{ game_id: string }>(
    `UPDATE games g
     SET status = 'abandoned',
         ended_at = COALESCE(
           (SELECT MAX(gs.saved_at) FROM game_states gs WHERE gs.game_id = g.game_id),
           g.started_at,
           g.created_at,
           NOW()
         )
     WHERE g.game_id IN (
       SELECT candidate.game_id
       FROM games candidate
       WHERE candidate.status IN ('waiting', 'in_progress')
         AND ${LAST_ACTIVITY_SQL} <= NOW() - ($1 * INTERVAL '1 millisecond')
       LIMIT $2
     )
     RETURNING g.game_id`,
    [STALE_GAME_ABANDON_MS, STALE_GAME_ABANDON_BATCH],
  );

  return result.map((row) => row.game_id);
}

/**
 * Prune per-turn replay snapshots for games that ended beyond the retention
 * window. The game row is kept (history/stats); only its game_states rows go,
 * so replays remain available for GAME_STATE_RETENTION_DAYS after the game
 * ends. Deletes at most SNAPSHOT_PRUNE_BATCH rows per call (returns the count),
 * so a backlog drains over multiple ticks rather than one unbounded DELETE.
 */
export async function deleteExpiredGameStateSnapshots(): Promise<number> {
  const result = await query<{ id: string }>(
    `DELETE FROM game_states
     WHERE ctid IN (
       SELECT gs.ctid
       FROM game_states gs
       JOIN games g ON g.game_id = gs.game_id
       WHERE g.status IN ('completed', 'abandoned')
         AND COALESCE(g.ended_at, g.created_at) < NOW() - ($1 * INTERVAL '1 millisecond')
       LIMIT $2
     )
     RETURNING game_id AS id`,
    [GAME_STATE_RETENTION_MS, SNAPSHOT_PRUNE_BATCH],
  );
  return result.length;
}

export function startOrphanedGameSweep(): void {
  if (orphanedGameSweepInterval) return;

  // Idempotent cleanup, but gate to one node per tick to avoid N× redundant
  // scans across the cluster. Folds in snapshot retention (same cadence/lease).
  const tick = () =>
    runExclusive('orphaned-games', SWEEP_LOCK_TTL_MS, async () => {
      const deleted = await deleteInactiveHumanlessGames();
      if (deleted.length > 0) {
        console.log(`[Games] Deleted ${deleted.length} inactive humanless game(s)`);
      }
      // Runs BEFORE the snapshot prune so a game abandoned this tick can have
      // its snapshots reclaimed in the same tick (its back-dated ended_at is
      // already outside the retention window).
      const abandoned = await abandonStaleGames();
      if (abandoned.length > 0) {
        console.log(`[Games] Marked ${abandoned.length} stale game(s) abandoned`);
      }
      const prunedSnapshots = await deleteExpiredGameStateSnapshots();
      if (prunedSnapshots > 0) {
        console.log(`[Games] Pruned ${prunedSnapshots} expired game-state snapshot row(s)`);
      }
    });

  orphanedGameSweepInterval = setInterval(() => {
    tick().catch((err) => console.error('[Games] Orphaned game sweep error:', err));
  }, ORPHANED_GAME_SWEEP_INTERVAL_MS);

  orphanedGameSweepInterval.unref();

  tick().catch((err) => console.error('[Games] Initial orphaned game sweep error:', err));
}

export function stopOrphanedGameSweep(): void {
  if (!orphanedGameSweepInterval) return;
  clearInterval(orphanedGameSweepInterval);
  orphanedGameSweepInterval = null;
}
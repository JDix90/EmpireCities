import { query } from '../../db/postgres';

const ORPHANED_GAME_GRACE_PERIOD_MS = 4 * 60 * 60 * 1000;
const ORPHANED_GAME_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

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
         AND COALESCE(
           (SELECT MAX(gs.saved_at) FROM game_states gs WHERE gs.game_id = candidate.game_id),
           candidate.started_at,
           candidate.created_at
         ) <= NOW() - ($1 * INTERVAL '1 millisecond')
     )
     RETURNING g.game_id`,
    [ORPHANED_GAME_GRACE_PERIOD_MS],
  );

  return result.map((row) => row.game_id);
}

export function startOrphanedGameSweep(): void {
  if (orphanedGameSweepInterval) return;

  orphanedGameSweepInterval = setInterval(async () => {
    try {
      const deleted = await deleteInactiveHumanlessGames();
      if (deleted.length > 0) {
        console.log(`[Games] Deleted ${deleted.length} inactive humanless game(s)`);
      }
    } catch (err) {
      console.error('[Games] Orphaned game sweep error:', err);
    }
  }, ORPHANED_GAME_SWEEP_INTERVAL_MS);

  orphanedGameSweepInterval.unref();

  deleteInactiveHumanlessGames().catch((err) => {
    console.error('[Games] Initial orphaned game sweep error:', err);
  });
}

export function stopOrphanedGameSweep(): void {
  if (!orphanedGameSweepInterval) return;
  clearInterval(orphanedGameSweepInterval);
  orphanedGameSweepInterval = null;
}
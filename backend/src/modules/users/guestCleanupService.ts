import { query } from '../../db/postgres';
import { logger } from '../../utils/logger';
import { runExclusive, SWEEP_LOCK_TTL_MS } from '../../utils/singletonTask';

const GUEST_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
const GUEST_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let sweepInterval: ReturnType<typeof setInterval> | null = null;

export async function deleteStaleGuestUsers(): Promise<number> {
  const result = await query<{ user_id: string }>(
    `DELETE FROM users
     WHERE is_guest = true
       AND created_at <= NOW() - ($1 * INTERVAL '1 millisecond')
       AND NOT EXISTS (
         SELECT 1 FROM game_players gp WHERE gp.user_id = users.user_id
       )
     RETURNING user_id`,
    [GUEST_MAX_AGE_MS],
  );
  return result.length;
}

export function startGuestCleanupSweep(): void {
  // Idempotent DELETE, but gate to one node per tick across the cluster.
  const tick = () =>
    runExclusive('guest-cleanup', SWEEP_LOCK_TTL_MS, async () => {
      await deleteStaleGuestUsers();
    });
  void tick().catch((err) => logger.error({ err }, '[GuestCleanup] Initial sweep failed'));
  sweepInterval = setInterval(() => {
    void tick().catch((err) => logger.error({ err }, '[GuestCleanup] Sweep failed'));
  }, GUEST_SWEEP_INTERVAL_MS);
  sweepInterval.unref();
}

export function stopGuestCleanupSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

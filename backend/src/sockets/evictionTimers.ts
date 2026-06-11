/**
 * Pending no-humans eviction timers, keyed by game id.
 *
 * Eviction used to be an anonymous setTimeout closure that nothing could
 * cancel: a `game:leave` fired by a transient GamePage remount (StrictMode,
 * suspense flip, navigation) armed it, the immediate rejoin couldn't disarm
 * it, and five minutes later a LIVE game lost its turn timer and Redis state
 * out from under a connected player. Tracking the timers per game lets
 * `game:join` cancel the pending eviction the moment a player (re)connects.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Arm (or re-arm) the eviction check for a game. Replaces any pending timer. */
export function armEvictionTimer(gameId: string, delayMs: number, fn: () => void): void {
  cancelEvictionTimer(gameId);
  const timer = setTimeout(() => {
    timers.delete(gameId);
    fn();
  }, delayMs);
  timer.unref();
  timers.set(gameId, timer);
}

/** Cancel a pending eviction (player rejoined, game finished). Returns true if one was pending. */
export function cancelEvictionTimer(gameId: string): boolean {
  const timer = timers.get(gameId);
  if (!timer) return false;
  clearTimeout(timer);
  timers.delete(gameId);
  return true;
}

/** Visible for tests and ops metrics. */
export function pendingEvictionCount(): number {
  return timers.size;
}

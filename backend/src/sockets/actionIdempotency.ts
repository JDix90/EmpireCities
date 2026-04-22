/**
 * Per-(gameId,userId) action_id deduplication.
 *
 * Problem: Socket.io delivers on flaky mobile networks by retrying; a user
 * double-tapping "End Turn" during a reconnection can queue two identical
 * emits. Without dedup the server processes both — advancing the turn twice,
 * double-attacking a territory, or double-redeeming a card set.
 *
 * Fix: clients attach an opaque `action_id` (UUID) to mutating events. The
 * server remembers the last N IDs per (gameId,userId) key; a repeat is
 * silently dropped before any state mutation.
 *
 * Backward compatibility: older clients may not send an `action_id`. In that
 * case we fall through without dedup — the fix only activates for clients
 * that opt in. This lets us deploy the server first and the client on its
 * own cadence without a flag-day migration.
 *
 * Capacity: N=32 per key is enough to survive normal user spam while keeping
 * memory bounded. Entries are dropped when the game is removed from memory
 * (see `clearActionIdempotency(gameId)`).
 */

const MAX_IDS_PER_KEY = 32;

// key = `${gameId}:${userId}` → insertion-ordered set of action IDs
const seen = new Map<string, Set<string>>();

function key(gameId: string, userId: string): string {
  return `${gameId}:${userId}`;
}

/**
 * Returns true if this action_id should be processed. Returns false if it is
 * a duplicate of a recent action from the same (gameId,userId) pair.
 *
 * When actionId is undefined/empty (old client), always returns true — no
 * dedup available, fall through to normal handler logic.
 */
export function checkAndRecordActionId(
  gameId: string,
  userId: string,
  actionId: string | undefined | null,
): boolean {
  if (!actionId || typeof actionId !== 'string') return true;

  const k = key(gameId, userId);
  let ids = seen.get(k);
  if (!ids) {
    ids = new Set();
    seen.set(k, ids);
  }

  if (ids.has(actionId)) return false;

  // Maintain LRU window: Set preserves insertion order, so the oldest entry
  // is always the first one iterated.
  if (ids.size >= MAX_IDS_PER_KEY) {
    const oldest = ids.values().next().value;
    if (oldest !== undefined) ids.delete(oldest);
  }
  ids.add(actionId);
  return true;
}

/** Clear all tracked IDs for a game (call on game end / eviction from memory). */
export function clearActionIdempotency(gameId: string): void {
  const prefix = `${gameId}:`;
  for (const k of seen.keys()) {
    if (k.startsWith(prefix)) seen.delete(k);
  }
}

/** Test/ops helper. */
export function _resetActionIdempotency(): void {
  seen.clear();
}

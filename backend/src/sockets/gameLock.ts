import Redlock, { ResourceLockedError } from 'redlock';
import { redis } from '../db/redis';

export const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 150,
  retryJitter: 100,
  automaticExtensionThreshold: 1000,
});

/**
 * Redlock emits an error for every attempt that fails, retries included. A
 * game that is busy (a bot or away-AI turn holds the lock for its whole turn)
 * fails with ResourceLockedError; that is the lock doing its job, and the
 * caller gets an ExecutionError of its own if the retries run out. Logging it
 * as an error sent each one to Sentry: the old check looked for the text
 * "LockError", which "ResourceLockedError" does not contain.
 */
export function onRedlockError(err: unknown): void {
  if (err instanceof ResourceLockedError) return;
  console.error('[Redlock] Unexpected error:', err);
}

redlock.on('error', onRedlockError);

/**
 * Acquire the per-game mutex, run fn, release.
 * Default 5s covers normal actions; pass 15_000 for AI turns.
 */
export async function runWithGameLock<T>(
  gameId: string,
  fn: () => Promise<T>,
  durationMs = 5000,
): Promise<T> {
  const lock = await redlock.acquire([`game:${gameId}:lock`], durationMs);
  try {
    return await fn();
  } finally {
    await lock.release().catch(() => {
      console.warn('[Redlock] Failed to release lock for', gameId);
    });
  }
}

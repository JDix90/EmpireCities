import Redlock from 'redlock';
import { redis } from '../db/redis';

export const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 150,
  retryJitter: 100,
  automaticExtensionThreshold: 1000,
});

redlock.on('error', (err) => {
  if (!String(err).includes('LockError')) {
    console.error('[Redlock] Unexpected error:', err);
  }
});

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

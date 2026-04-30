import { redis } from '../db/redis';

/**
 * Redis-backed sliding-window-ish rate limiter. The key counts events per
 * `windowMs`; the counter is set with `PEXPIRE NX` so the TTL is established
 * exactly once per window.
 *
 * Returns `true` if the action is allowed and false if the bucket is full.
 *
 * Falls open on Redis errors — we'd rather accept the request than deny it
 * when our limiter infrastructure is down.
 */
export async function rateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): Promise<boolean> {
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) {
      await redis.pexpire(k, opts.windowMs);
    }
    return count <= opts.max;
  } catch (err) {
    console.warn('[rateLimit] redis error, falling open:', err);
    return true;
  }
}

/** Reset a rate-limit bucket — primarily for tests. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await redis.del(`rl:${key}`);
  } catch {
    /* ignore */
  }
}

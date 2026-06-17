import { randomUUID } from 'crypto';
import { redis } from '../db/redis';

// One token per process — lets us recognise our own lease in logs/debugging.
const INSTANCE_TOKEN = randomUUID();

/**
 * Default lease lifetime. Must be >> a single tick's work (these sweeps finish
 * in well under a second) and >> clock skew between instances, but << the
 * shortest sweep interval (15 min) so the lease always expires before the next
 * tick and a dead leader is replaced on the following interval.
 */
export const SWEEP_LOCK_TTL_MS = 60_000;

/**
 * Run `fn` only if this instance wins a short Redis lease named `name`.
 *
 * Periodic boot sweeps (season rewards, monthly challenges, orphaned-game and
 * guest cleanup) are started on EVERY instance. On a multi-node deploy that
 * means N instances run the same work each tick — wasteful, and for the season
 * sweep it risked double-paying gold. This gates each tick so the work runs on
 * exactly one node per interval.
 *
 * The lease is intentionally NOT released on success: holding it for its TTL is
 * what stops a sibling instance — whose interval fires at ~the same instant —
 * from also running this tick. The TTL (not an explicit unlock) provides
 * failover if the holder dies mid-tick.
 *
 * Falls OPEN on a Redis error (runs the work): a missed sweep is worse than a
 * rare duplicate, and every wrapped sweep is independently idempotent (the
 * season payout claims each row atomically; the rest are `ON CONFLICT` upserts
 * or idempotent `DELETE`s). If Redis is down the app is largely non-functional
 * anyway, so this can't make things meaningfully worse.
 */
export async function runExclusive(
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    const acquired = await redis.set(`sweeplock:${name}`, INSTANCE_TOKEN, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return; // another instance owns this tick
  } catch (err) {
    console.warn(`[singleton:${name}] Redis lease error — running anyway:`, err);
  }
  await fn();
}

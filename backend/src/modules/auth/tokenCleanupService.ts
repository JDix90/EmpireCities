import { query } from '../../db/postgres';
import { logger } from '../../utils/logger';
import { runExclusive, SWEEP_LOCK_TTL_MS } from '../../utils/singletonTask';
import { scheduleBootSweep } from '../../utils/bootSweep';

/**
 * Deletes sign-in records that can no longer sign anyone in.
 *
 * Nothing removed them before. Every refresh revokes its row and inserts a new
 * one, so refresh_tokens grew by a row per session per hour of play, forever;
 * used and expired password-reset and sign-in-link rows stayed too (a new
 * request only clears that account's unused ones). Migration 022 even indexed
 * refresh_tokens.expires_at "for cleanup sweeps" that never existed.
 *
 * A row is dead when the code that reads it would refuse it anyway:
 * - refresh_tokens: /auth/refresh accepts only a row that exists and is not
 *   revoked, for a JWT that has not expired, or one rotation replaced in the
 *   last ten minutes. So an expired row, or a revoked one, signs no one in,
 *   and a missing row gets the same 401.
 * - password_reset_tokens, sign_in_link_tokens: redeemed only while
 *   `used_at IS NULL AND expires_at > NOW()`.
 *
 * Each is kept a day past that point, so nothing in flight around the moment
 * it stopped working can see it disappear. Deletes go in batches, so the first
 * run on a table that has grown for years does not hold one long delete; what
 * a tick leaves, the next one takes.
 */

const TOKEN_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const TOKEN_CLEANUP_BATCH = 5_000;
export const TOKEN_CLEANUP_MAX_BATCHES = 40; // per table per tick: 200k rows

const GRACE = "INTERVAL '1 day'";

export const TOKEN_TABLES = [
  {
    table: 'refresh_tokens',
    key: 'token_id',
    // A rotated row counts from when it was replaced, not when it was issued:
    // /auth/refresh can still accept it for a few minutes after (migration 054).
    dead: `expires_at < NOW() - ${GRACE} OR (revoked AND COALESCE(rotated_at, created_at) < NOW() - ${GRACE})`,
  },
  {
    table: 'password_reset_tokens',
    key: 'id',
    dead: `expires_at < NOW() - ${GRACE} OR used_at < NOW() - ${GRACE}`,
  },
  {
    table: 'sign_in_link_tokens',
    key: 'id',
    dead: `expires_at < NOW() - ${GRACE} OR used_at < NOW() - ${GRACE}`,
  },
] as const;

export type TokenTable = (typeof TOKEN_TABLES)[number]['table'];

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let cancelBootRun: (() => void) | null = null;

/** Deletes every dead row, a batch at a time. Returns how many went from each table. */
export async function deleteDeadTokens(): Promise<Record<TokenTable, number>> {
  const deleted = {} as Record<TokenTable, number>;
  for (const { table, key, dead } of TOKEN_TABLES) {
    deleted[table] = 0;
    for (let batch = 0; batch < TOKEN_CLEANUP_MAX_BATCHES; batch += 1) {
      const rows = await query<{ n: number }>(
        `WITH dead AS (
           SELECT ${key} FROM ${table} WHERE ${dead} LIMIT $1
         ), gone AS (
           DELETE FROM ${table} t USING dead WHERE t.${key} = dead.${key} RETURNING 1
         )
         SELECT COUNT(*)::int AS n FROM gone`,
        [TOKEN_CLEANUP_BATCH],
      );
      const n = Number(rows[0]?.n ?? 0);
      deleted[table] += n;
      if (n < TOKEN_CLEANUP_BATCH) break;
    }
  }
  return deleted;
}

export function startTokenCleanupSweep(): void {
  // Idempotent DELETEs, but gate to one node per tick across the cluster.
  const tick = () =>
    runExclusive('token-cleanup', SWEEP_LOCK_TTL_MS, async () => {
      const deleted = await deleteDeadTokens();
      if (Object.values(deleted).some((n) => n > 0)) {
        logger.info({ deleted }, '[TokenCleanup] Deleted dead sign-in tokens');
      }
    });
  // First run shortly after boot (utils/bootSweep.ts).
  cancelBootRun = scheduleBootSweep('token-cleanup', () => {
    void tick().catch((err) => logger.error({ err }, '[TokenCleanup] Initial sweep failed'));
  });
  sweepInterval = setInterval(() => {
    void tick().catch((err) => logger.error({ err }, '[TokenCleanup] Sweep failed'));
  }, TOKEN_SWEEP_INTERVAL_MS);
  sweepInterval.unref();
}

export function stopTokenCleanupSweep(): void {
  cancelBootRun?.();
  cancelBootRun = null;
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

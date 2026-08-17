import { pgPool } from '../db/postgres';
import { redis } from '../db/redis';

export type ReadinessCheck = { name: string; ok: boolean; detail?: string };

/**
 * Dependency checks for orchestrator readiness probes (GET /ready).
 * Does not verify Socket.io or game workers — only data stores the API depends on.
 */
export async function runReadinessChecks(): Promise<{ ok: boolean; checks: ReadinessCheck[] }> {
  const checks: ReadinessCheck[] = [];

  try {
    await pgPool.query('SELECT 1');
    checks.push({ name: 'postgres', ok: true });
  } catch (e) {
    checks.push({
      name: 'postgres',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // PING alone is NOT enough: a Redis that has hit `maxmemory` under
  // `noeviction`, or gone read-only after a failed BGSAVE/AOF write (MISCONF),
  // still answers PONG while rejecting every write with an -OOM/-MISCONF
  // error. The API writes to Redis on the hot path of *every* request (the
  // rate-limit counter), so a write-rejecting Redis is a hard outage that this
  // probe used to report as healthy. Probe an actual write.
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      checks.push({ name: 'redis', ok: false, detail: pong });
    } else {
      await redis.set('health:write-probe', Date.now().toString(), 'EX', 60);
      checks.push({ name: 'redis', ok: true });
    }
  } catch (e) {
    checks.push({
      name: 'redis',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

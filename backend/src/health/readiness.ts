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

  try {
    const pong = await redis.ping();
    checks.push({ name: 'redis', ok: pong === 'PONG', detail: pong !== 'PONG' ? pong : undefined });
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

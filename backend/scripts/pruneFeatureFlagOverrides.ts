/**
 * Ops utility: drop `admin_config.feature_flags` overrides that merely restate
 * the current code default.
 *
 * Why this exists: the admin panel used to PATCH the whole flag object, so one
 * toggle click pinned EVERY flag as an explicit override. Those stale pins
 * silently defeat any later change to a committed default in
 * `config/featureFlags.ts`. Pruning them restores the intended precedence —
 * code default, unless an operator has deliberately forced the flag.
 *
 * Only redundant keys are removed. A genuine override (one that disagrees with
 * the code default) is always kept, and is reported so you can see what this
 * environment is actually forcing.
 *
 * Usage:
 *   pnpm -C backend exec tsx scripts/pruneFeatureFlagOverrides.ts          # preview
 *   pnpm -C backend exec tsx scripts/pruneFeatureFlagOverrides.ts --apply  # write
 */
import 'dotenv/config';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';
import { redis } from '../src/db/redis/index';
import { refreshAdminConfigCache, ADMIN_CONFIG_CHANNEL } from '../src/services/adminConfig';
import { getFeatureFlagCodeDefault, FLAG_CODE_DEFAULTS } from '../src/config/featureFlags';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  await connectPostgres();
  // Flag defaults are pure code/env, but the cache must be warm so the row we
  // read is the same one the app resolves against.
  await refreshAdminConfigCache();

  const row = await query<{ value: unknown }>(
    `SELECT value FROM admin_config WHERE config_key = 'feature_flags'`,
  );
  if (row.length === 0) {
    console.log('[prune-flags] No feature_flags row — every flag already runs on its code default.');
    await pgPool.end();
    return;
  }

  const current = (row[0].value ?? {}) as Record<string, unknown>;
  const keys = Object.keys(current);
  if (keys.length === 0) {
    console.log('[prune-flags] feature_flags row is empty — nothing to prune.');
    await pgPool.end();
    return;
  }

  const kept: Record<string, boolean> = {};
  const redundant: string[] = [];
  const unknown: string[] = [];

  for (const key of keys) {
    const value = current[key];
    if (typeof value !== 'boolean') {
      unknown.push(`${key} (non-boolean, dropped)`);
      continue;
    }
    if (!(key in FLAG_CODE_DEFAULTS)) {
      // A flag that no longer exists in code: keep nothing, but say so loudly.
      unknown.push(`${key} (no such flag in code, dropped)`);
      continue;
    }
    if (value === getFeatureFlagCodeDefault(key)) {
      redundant.push(`${key}=${value}`);
    } else {
      kept[key] = value;
    }
  }

  console.log(`[prune-flags] ${keys.length} override(s) in the DB row.`);
  console.log(`[prune-flags] Redundant (same as code default): ${redundant.length ? redundant.join(', ') : 'none'}`);
  console.log(`[prune-flags] Unknown/invalid: ${unknown.length ? unknown.join(', ') : 'none'}`);
  const keptEntries = Object.entries(kept);
  console.log(
    `[prune-flags] Genuine overrides kept: ${
      keptEntries.length ? keptEntries.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'
    }`,
  );

  if (redundant.length === 0 && unknown.length === 0) {
    console.log('[prune-flags] Nothing to do.');
    await pgPool.end();
    return;
  }

  if (!APPLY) {
    console.log('[prune-flags] Preview only — re-run with --apply to write.');
    await pgPool.end();
    return;
  }

  await query(
    `UPDATE admin_config SET value = $1::jsonb, updated_at = NOW() WHERE config_key = 'feature_flags'`,
    [JSON.stringify(kept)],
  );
  await refreshAdminConfigCache();

  // Sibling instances cache this row; without the invalidation they keep the
  // pruned overrides until their next restart.
  await redis.publish(ADMIN_CONFIG_CHANNEL, 'feature_flags');
  await redis.quit();

  console.log(`[prune-flags] Applied. Row now holds ${keptEntries.length} override(s); invalidation published.`);
  await pgPool.end();
}

main().catch((err) => {
  console.error('[prune-flags] Failed:', err);
  process.exit(1);
});

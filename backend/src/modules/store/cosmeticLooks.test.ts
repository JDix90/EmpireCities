/**
 * Every item in the catalog can be drawn: it has a look in @borderfall/shared's
 * COSMETIC_LOOKS, of the kind its type is equipped as. An item without one
 * would sell, equip and then show nothing, which is what the store overhaul
 * set out to end.
 *
 * The catalog is what a fresh database holds: the migrations (already run
 * against the test database) plus the SQL seeds, which run after them. The
 * seeds' cosmetics go into a temporary copy of the table, inside a transaction
 * that is rolled back, so nothing is written to the shared table while other
 * test files use it.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1:
 *   PG_TEST=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5499 POSTGRES_USER=postgres \
 *     POSTGRES_DB=borderfall POSTGRES_PASSWORD= \
 *     pnpm exec vitest run src/modules/store/cosmeticLooks.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { COSMETIC_TYPE_KIND, cosmeticLook } from '@borderfall/shared';

const enabled = process.env.PG_TEST === '1';
const SEEDS_DIR = join(__dirname, '../../../../database/seeds');

/**
 * Removed from the catalog by migration 044 except where someone owned one
 * (nothing grants them any more), so a database can still hold them.
 */
const KEPT_WHERE_OWNED: Array<[id: string, type: string]> = [
  ['frame_warlord', 'profile_frame'],
  ['frame_prestige_1', 'profile_frame'],
  ['frame_prestige_2', 'profile_frame'],
  ['badge_rival', 'profile_banner'],
  ['badge_nemesis', 'profile_banner'],
  ['marker_emperor', 'map_marker'],
];

/** Why `id` can't be drawn in the slot its type goes in, or null when it can. */
function lookProblem(id: string, type: string): string | null {
  const kind = COSMETIC_TYPE_KIND[type];
  if (!kind) return `${id}: type ${type} has no slot to equip it in`;
  const look = cosmeticLook(id);
  if (!look) return `${id}: no look`;
  if (look.kind !== kind) return `${id}: a ${look.kind} look for a ${type}`;
  return null;
}

describe.runIf(enabled)('cosmetic looks cover the catalog (Postgres)', () => {
  let pgPool: Pool;

  beforeAll(async () => {
    ({ pgPool } = (await import('../../db/postgres')) as unknown as { pgPool: Pool });
  });

  it('gives every item a fresh database holds a look of its kind', async () => {
    const client = await pgPool.connect();
    let rows: Array<{ cosmetic_id: string; type: string }>;
    try {
      await client.query('BEGIN');
      // The temporary table comes first on the search path, so the seeds'
      // unqualified `INSERT INTO cosmetics` lands in it.
      await client.query('CREATE TEMP TABLE cosmetics (LIKE public.cosmetics INCLUDING ALL) ON COMMIT DROP');
      await client.query(
        `INSERT INTO pg_temp.cosmetics SELECT * FROM public.cosmetics WHERE cosmetic_id NOT LIKE 'test\\_%'`,
      );
      for (const seed of readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        const sql = readFileSync(join(SEEDS_DIR, seed), 'utf8');
        const inserts = sql.match(/INSERT INTO cosmetics\b[\s\S]*?;/g) ?? [];
        // Every cosmetics insert in the file was found (none cut short by a `;`).
        expect(inserts.length, seed).toBe(sql.match(/INSERT INTO cosmetics\b/g)?.length ?? 0);
        for (const statement of inserts) await client.query(statement);
      }
      ({ rows } = await client.query('SELECT cosmetic_id, type FROM pg_temp.cosmetics ORDER BY cosmetic_id'));
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }

    const ids = rows.map((r) => r.cosmetic_id);
    // From the seeds, and from the migrations.
    expect(ids).toEqual(expect.arrayContaining(['bone_dice', 'general_banner', 'frame_bronze', 'frame_level_50']));
    expect(rows.map((r) => lookProblem(r.cosmetic_id, r.type)).filter(Boolean)).toEqual([]);
  });

  it('gives the items kept only where owned a look of their kind', () => {
    expect(KEPT_WHERE_OWNED.map(([id, type]) => lookProblem(id, type)).filter(Boolean)).toEqual([]);
  });
});

/**
 * Borderfall — PostgreSQL Map Seeder
 * Seeds historical era + community maps into the `maps` table (JSONB).
 *
 * Usage (from repo root):
 *   pnpm run seed:maps
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import Redis from 'ioredis';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const MAP_FILES = [
  'era_ancient.json',
  'era_medieval.json',
  'era_discovery.json',
  'era_ww2.json',
  'era_coldwar.json',
  'era_modern.json',
  'era_acw.json',
  'era_risorgimento.json',
  'era_space_age.json',
  'era_galaxy.json',
];

const COMMUNITY_MAP_FILES: { file: string; creator_id: string }[] = [
  { file: 'community_14_nations.json', creator_id: 'jmd' },
  { file: 'community_strait_hormuz.json', creator_id: 'jmd' },
  { file: 'community_charlemagne_814.json', creator_id: 'system' },
  { file: 'community_balkanized_usa.json', creator_id: 'system' },
  { file: 'community_fractured_china.json', creator_id: 'system' },
  { file: 'community_balkanized_india.json', creator_id: 'system' },
  { file: 'community_uncolonized_africa.json', creator_id: 'system' },
  { file: 'community_south_america.json', creator_id: 'system' },
  { file: 'community_divided_japan.json', creator_id: 'system' },
  { file: 'community_fractured_russia.json', creator_id: 'system' },
  { file: 'community_byzantium_megali.json', creator_id: 'system' },
  { file: 'community_balkanized_spain.json', creator_id: 'system' },
  { file: 'community_nusantara.json', creator_id: 'system' },
  { file: 'community_britain_925.json', creator_id: 'system' },
  { file: 'community_horn_africa.json', creator_id: 'system' },
  { file: 'community_australia_1337.json', creator_id: 'system' },
  { file: 'community_flooded_north_america.json', creator_id: 'system' },
  { file: 'community_mongol_empire.json', creator_id: 'system' },
  { file: 'community_napoleonic_europe.json', creator_id: 'system' },
  { file: 'community_roman_empire_117.json', creator_id: 'system' },
  { file: 'community_sengoku_japan.json', creator_id: 'system' },
];

const MAPS_DIR = path.resolve(__dirname, 'maps');

interface SeedDoc {
  map_id: string;
  creator_id: string;
  name: string;
  description: string;
  era_theme: string;
  canvas_width: number;
  canvas_height: number;
  projection_bounds?: unknown;
  globe_view?: unknown;
  map_kind?: string;
  worlds?: unknown;
  orbit_access?: string;
  rts_terrain?: unknown;
  territories: unknown;
  connections: unknown;
  regions: unknown;
}

async function upsertMap(pool: Pool, doc: SeedDoc): Promise<'inserted' | 'updated'> {
  const existing = await pool.query('SELECT map_id FROM maps WHERE map_id = $1', [doc.map_id]);
  if (existing.rowCount === 0) {
    await pool.query(
      `INSERT INTO maps (
        map_id, creator_id, name, description, era_theme, canvas_width, canvas_height,
        projection_bounds, globe_view, map_kind, worlds, orbit_access, rts_terrain,
        territories, connections, regions, is_public, is_moderated, moderation_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10, $11::jsonb, $12, $13::jsonb,
        $14::jsonb, $15::jsonb, $16::jsonb, true, true, 'approved'
      )`,
      [
        doc.map_id,
        doc.creator_id,
        doc.name,
        doc.description,
        doc.era_theme,
        doc.canvas_width,
        doc.canvas_height,
        doc.projection_bounds ? JSON.stringify(doc.projection_bounds) : null,
        doc.globe_view ? JSON.stringify(doc.globe_view) : null,
        doc.map_kind ?? null,
        doc.worlds ? JSON.stringify(doc.worlds) : null,
        doc.orbit_access ?? null,
        doc.rts_terrain ? JSON.stringify(doc.rts_terrain) : null,
        JSON.stringify(doc.territories),
        JSON.stringify(doc.connections),
        JSON.stringify(doc.regions),
      ],
    );
    return 'inserted';
  }

  await pool.query(
    `UPDATE maps SET
      name = $2, description = $3, era_theme = $4, canvas_width = $5, canvas_height = $6,
      projection_bounds = $7::jsonb, globe_view = $8::jsonb, map_kind = $9, worlds = $10::jsonb,
      orbit_access = $11, rts_terrain = $12::jsonb,
      territories = $13::jsonb, connections = $14::jsonb, regions = $15::jsonb,
      is_public = true, is_moderated = true, moderation_status = 'approved', updated_at = NOW()
     WHERE map_id = $1`,
    [
      doc.map_id,
      doc.name,
      doc.description,
      doc.era_theme,
      doc.canvas_width,
      doc.canvas_height,
      doc.projection_bounds ? JSON.stringify(doc.projection_bounds) : null,
      doc.globe_view ? JSON.stringify(doc.globe_view) : null,
      doc.map_kind ?? null,
      doc.worlds ? JSON.stringify(doc.worlds) : null,
      doc.orbit_access ?? null,
      doc.rts_terrain ? JSON.stringify(doc.rts_terrain) : null,
      JSON.stringify(doc.territories),
      JSON.stringify(doc.connections),
      JSON.stringify(doc.regions),
    ],
  );
  return 'updated';
}

function buildDoc(data: Record<string, unknown>, creator_id: string): SeedDoc {
  return {
    map_id: data.map_id as string,
    creator_id,
    name: data.name as string,
    description: (data.description as string) || '',
    era_theme: (data.era_theme as string) || '',
    canvas_width: (data.canvas_width as number) ?? 1200,
    canvas_height: (data.canvas_height as number) ?? 700,
    projection_bounds: data.projection_bounds,
    globe_view: data.globe_view,
    map_kind: data.map_kind as string | undefined,
    worlds: data.worlds,
    orbit_access: data.orbit_access as string | undefined,
    rts_terrain: data.rts_terrain,
    territories: data.territories,
    connections: data.connections,
    regions: data.regions,
  };
}

async function seedMaps(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'chronouser',
    password: process.env.POSTGRES_PASSWORD || 'chronopass',
    database: process.env.POSTGRES_DB || 'borderfall',
  });

  console.log('═'.repeat(60));
  console.log('Borderfall — Map Seeder (PostgreSQL)');
  console.log('═'.repeat(60));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const filename of MAP_FILES) {
    const filepath = path.join(MAPS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      console.warn(`  ⚠ Not found, skipping: ${filename}`);
      skipped++;
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const doc = buildDoc(data, 'system');

    try {
      const action = await upsertMap(pool, doc);
      if (action === 'inserted') {
        console.log(`  ✓ INSERTED: ${doc.name}`);
        inserted++;
      } else {
        console.log(`  ↻ UPDATED:  ${doc.name}`);
        updated++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR seeding ${filename}: ${msg}`);
    }
  }

  for (const { file: filename, creator_id } of COMMUNITY_MAP_FILES) {
    const filepath = path.join(MAPS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      console.warn(`  ⚠ Community map not found, skipping: ${filename}`);
      skipped++;
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const doc = buildDoc(data, creator_id);

    try {
      const action = await upsertMap(pool, doc);
      if (action === 'inserted') {
        console.log(`  ✓ INSERTED (community): ${doc.name}`);
        inserted++;
      } else {
        console.log(`  ↻ UPDATED (community):  ${doc.name}`);
        updated++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ERROR seeding community ${filename}: ${msg}`);
    }
  }

  const total = await pool.query('SELECT COUNT(*)::int AS count FROM maps');
  console.log('\n' + '─'.repeat(60));
  console.log(`Seeding complete: inserted=${inserted} updated=${updated} skipped=${skipped}`);
  console.log(`Total maps in PostgreSQL: ${total.rows[0]?.count ?? 0}`);

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD || 'chronoredis';
  try {
    const redis = new Redis({ host: redisHost, port: redisPort, password: redisPassword });
    const keys = await redis.keys('map:*');
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    console.log(`Cleared ${keys.length} map cache key(s) from Redis`);
  } catch {
    console.warn('Could not clear Redis map cache (non-fatal)');
  }

  await pool.end();
  console.log('✅ Done.');
}

seedMaps().catch((err) => {
  console.error(err);
  process.exit(1);
});

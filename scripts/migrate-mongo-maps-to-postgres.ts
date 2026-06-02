/**
 * One-time migration: copy MongoDB custommaps + mapratings into PostgreSQL.
 *
 * Prerequisites:
 *   - Migration 028_maps_postgres.sql applied
 *   - MongoDB still running with existing data (or skip if greenfield — use seed:maps instead)
 *
 * Usage:
 *   pnpm run migrate:maps-from-mongo
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

async function main(): Promise<void> {
  const mongoUri =
    process.env.MONGO_URI ||
    'mongodb://chronouser:chronopass@localhost:27017/borderfall_maps?authSource=admin';

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'chronouser',
    password: process.env.POSTGRES_PASSWORD || 'chronopass',
    database: process.env.POSTGRES_DB || 'borderfall',
  });

  console.log('[migrate-maps] Connecting to MongoDB…');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');

  const maps = await db.collection('custommaps').find({}).toArray();
  console.log(`[migrate-maps] Found ${maps.length} map document(s) in MongoDB`);

  let mapsUpserted = 0;
  for (const m of maps) {
    const doc = m as Record<string, unknown>;
    await pool.query(
      `INSERT INTO maps (
        map_id, creator_id, name, description, era_theme, background_image_url,
        canvas_width, canvas_height, projection_bounds, globe_view, map_kind, worlds,
        orbit_access, rts_terrain, territories, connections, regions,
        is_public, is_moderated, moderation_status, rating, rating_count, play_count,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb,
        $13, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
        $18, $19, $20, $21, $22, $23,
        COALESCE($24::timestamptz, NOW()), COALESCE($25::timestamptz, NOW())
      )
      ON CONFLICT (map_id) DO UPDATE SET
        creator_id = EXCLUDED.creator_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        era_theme = EXCLUDED.era_theme,
        background_image_url = EXCLUDED.background_image_url,
        canvas_width = EXCLUDED.canvas_width,
        canvas_height = EXCLUDED.canvas_height,
        projection_bounds = EXCLUDED.projection_bounds,
        globe_view = EXCLUDED.globe_view,
        map_kind = EXCLUDED.map_kind,
        worlds = EXCLUDED.worlds,
        orbit_access = EXCLUDED.orbit_access,
        rts_terrain = EXCLUDED.rts_terrain,
        territories = EXCLUDED.territories,
        connections = EXCLUDED.connections,
        regions = EXCLUDED.regions,
        is_public = EXCLUDED.is_public,
        is_moderated = EXCLUDED.is_moderated,
        moderation_status = EXCLUDED.moderation_status,
        rating = EXCLUDED.rating,
        rating_count = EXCLUDED.rating_count,
        play_count = EXCLUDED.play_count,
        updated_at = EXCLUDED.updated_at`,
      [
        doc.map_id,
        doc.creator_id ?? 'system',
        doc.name,
        doc.description ?? '',
        doc.era_theme ?? null,
        doc.background_image_url ?? null,
        doc.canvas_width ?? 1200,
        doc.canvas_height ?? 700,
        doc.projection_bounds ? JSON.stringify(doc.projection_bounds) : null,
        doc.globe_view ? JSON.stringify(doc.globe_view) : null,
        doc.map_kind ?? null,
        doc.worlds ? JSON.stringify(doc.worlds) : null,
        doc.orbit_access ?? null,
        doc.rts_terrain ? JSON.stringify(doc.rts_terrain) : null,
        JSON.stringify(doc.territories ?? []),
        JSON.stringify(doc.connections ?? []),
        JSON.stringify(doc.regions ?? []),
        doc.is_public ?? false,
        doc.is_moderated ?? false,
        doc.moderation_status ?? 'pending',
        doc.rating ?? 0,
        doc.rating_count ?? 0,
        doc.play_count ?? 0,
        doc.created_at ? new Date(doc.created_at as string | Date).toISOString() : null,
        doc.updated_at ? new Date(doc.updated_at as string | Date).toISOString() : null,
      ],
    );
    mapsUpserted++;
  }

  const ratings = await db.collection('mapratings').find({}).toArray();
  console.log(`[migrate-maps] Found ${ratings.length} rating row(s) in MongoDB`);

  let ratingsUpserted = 0;
  let ratingsSkipped = 0;
  for (const r of ratings) {
    const row = r as Record<string, unknown>;
    const userId = row.user_id as string;
    const userCheck = await pool.query('SELECT 1 FROM users WHERE user_id = $1::uuid', [userId]);
    if (userCheck.rowCount === 0) {
      ratingsSkipped++;
      continue;
    }
    await pool.query(
      `INSERT INTO map_ratings (map_id, user_id, rating, created_at, updated_at)
       VALUES ($1, $2::uuid, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (map_id, user_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         updated_at = EXCLUDED.updated_at`,
      [
        row.map_id,
        userId,
        row.rating,
        row.created_at ? new Date(row.created_at as string | Date).toISOString() : null,
        row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : null,
      ],
    );
    ratingsUpserted++;
  }

  console.log(`[migrate-maps] Upserted ${mapsUpserted} maps, ${ratingsUpserted} ratings (${ratingsSkipped} ratings skipped — user missing)`);
  console.log('[migrate-maps] Done. You can decommission MongoDB after verifying gameplay.');

  await mongoose.disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate-maps] Failed:', err);
  process.exit(1);
});

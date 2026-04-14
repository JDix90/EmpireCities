/**
 * Eras of Empire — MongoDB Map Seeder (Mongoose version)
 * Seeds all 5 historical era maps into MongoDB using the same Mongoose
 * CustomMap model that the game server uses, ensuring perfect schema alignment.
 *
 * Usage (from project root):
 *   pnpm run seed:maps
 *
 * Or from backend folder:
 *   cd backend && pnpm run seed:maps
 *
 * Or directly:
 *   cd backend && npx tsx ../database/seedMaps.ts
 */

import * as path from 'path';
import * as fs   from 'fs';
import * as dotenv from 'dotenv';

// Load backend .env
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

import mongoose from 'mongoose';
import Redis from 'ioredis';

// ─── Inline the CustomMap schema (mirrors MapModel.ts exactly) ────────────────
// We inline it here so the seeder can run standalone without importing the full
// backend module graph (which requires all services to be available).

const TerritorySchema = new mongoose.Schema({
  territory_id:  { type: String, required: true },
  name:          { type: String, required: true },
  polygon:       { type: [[Number]], required: true },
  center_point:  { type: [Number], required: true },
  region_id:     { type: String, required: true },
  /** WGS84 rings — must match MapModel.ts or Mongoose strips them on seed (globe needs this). */
  geo_polygon:   { type: [[Number]], default: undefined },
}, { _id: false });

const ConnectionSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to:   { type: String, required: true },
  type: { type: String, enum: ['land', 'sea'], default: 'land' },
}, { _id: false });

const RegionSchema = new mongoose.Schema({
  region_id: { type: String, required: true },
  name:      { type: String, required: true },
  bonus:     { type: Number, required: true },
}, { _id: false });

const GlobeViewSchema = new mongoose.Schema({
  lock_rotation: { type: Boolean },
  center_lat:    { type: Number },
  center_lng:    { type: Number },
  altitude:      { type: Number },
}, { _id: false });

const ProjectionBoundsSchema = new mongoose.Schema({
  minLng: { type: Number, required: true },
  maxLng: { type: Number, required: true },
  minLat: { type: Number, required: true },
  maxLat: { type: Number, required: true },
}, { _id: false });

const MapSchema = new mongoose.Schema({
  map_id:            { type: String, required: true, unique: true },
  creator_id:        { type: String, required: true, default: 'system' },
  name:              { type: String, required: true },
  description:       { type: String, default: '' },
  era_theme:         { type: String, default: '' },
  background_image_url: { type: String, default: '' },
  canvas_width:      { type: Number, default: 1200 },
  canvas_height:     { type: Number, default: 700 },
  projection_bounds: { type: ProjectionBoundsSchema, required: false },
  globe_view:        { type: GlobeViewSchema, required: false },
  territories:       { type: [TerritorySchema], required: true },
  connections:       { type: [ConnectionSchema], required: true },
  regions:           { type: [RegionSchema], required: true },
  is_public:         { type: Boolean, default: true },
  is_moderated:      { type: Boolean, default: true },
  moderation_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  rating:            { type: Number, default: 0 },
  rating_count:      { type: Number, default: 0 },
  play_count:        { type: Number, default: 0 },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

const SeederMap = mongoose.model('CustomMap', MapSchema);

// ─── Map files ────────────────────────────────────────────────────────────────
const MAP_FILES = [
  'era_ancient.json',
  'era_medieval.json',
  'era_discovery.json',
  'era_ww2.json',
  'era_coldwar.json',
  'era_modern.json',
  'era_acw.json',
  'era_risorgimento.json',
];

/** Community maps: same schema as era JSON, but published under a user id for Map Hub. */
const COMMUNITY_MAP_FILES: { file: string; creator_id: string }[] = [
  { file: 'community_14_nations.json', creator_id: 'jmd' },
  { file: 'community_strait_hormuz.json', creator_id: 'jmd' },
  { file: 'community_britain_925.json', creator_id: 'system' },
  { file: 'community_horn_africa.json', creator_id: 'system' },
  { file: 'community_australia_1337.json', creator_id: 'system' },
];

const MAPS_DIR = path.resolve(__dirname, 'maps');

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seedMaps(): Promise<void> {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://chronouser:chronopass@localhost:27017/erasofempire_maps?authSource=admin';

  console.log('═'.repeat(60));
  console.log('Eras of Empire — Map Seeder');
  console.log('═'.repeat(60));
  console.log(`Connecting to MongoDB...`);

  await mongoose.connect(mongoUri);
  console.log('✓ Connected\n');

  let inserted = 0;
  let updated  = 0;
  let skipped  = 0;

  for (const filename of MAP_FILES) {
    const filepath = path.join(MAPS_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.warn(`  ⚠ Not found, skipping: ${filename}`);
      skipped++;
      continue;
    }

    const raw  = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(raw);

    // Build the document matching the Mongoose schema
    const doc = {
      map_id:            data.map_id,
      creator_id:        'system',
      name:              data.name,
      description:       data.description || '',
      era_theme:         data.era_theme   || '',
      background_image_url: '',
      canvas_width:      data.canvas_width ?? 1200,
      canvas_height:     data.canvas_height ?? 700,
      projection_bounds: data.projection_bounds ?? undefined,
      globe_view:        data.globe_view ?? undefined,
      territories:       data.territories,
      connections:       data.connections,
      regions:           data.regions,
      is_public:         true,
      is_moderated:      true,
      moderation_status: 'approved' as 'approved',
      rating:            0,
      rating_count:      0,
      play_count:        0,
    };

    try {
      const existing = await SeederMap.findOne({ map_id: doc.map_id });

      if (existing) {
        // Update map data but preserve play/rating stats
        await SeederMap.updateOne(
          { map_id: doc.map_id },
          {
            $set: {
              name:              doc.name,
              description:       doc.description,
              era_theme:         doc.era_theme,
              canvas_width:      doc.canvas_width,
              canvas_height:     doc.canvas_height,
              projection_bounds: doc.projection_bounds,
              globe_view:        doc.globe_view,
              territories:       doc.territories,
              connections:       doc.connections,
              regions:           doc.regions,
              is_public:         true,
              is_moderated:      true,
              moderation_status: 'approved',
            }
          }
        );
        console.log(`  ↻ UPDATED:  ${doc.name}`);
        updated++;
      } else {
        await SeederMap.create(doc);
        console.log(`  ✓ INSERTED: ${doc.name}`);
        console.log(`    ${doc.territories.length} territories · ${doc.connections.length} connections · ${doc.regions.length} regions`);
        inserted++;
      }
    } catch (err: any) {
      console.error(`  ✗ ERROR seeding ${filename}: ${err.message}`);
    }
  }

  for (const { file: filename, creator_id } of COMMUNITY_MAP_FILES) {
    const filepath = path.join(MAPS_DIR, filename);

    if (!fs.existsSync(filepath)) {
      console.warn(`  ⚠ Community map not found, skipping: ${filename}`);
      skipped++;
      continue;
    }

    const raw  = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(raw);

    const doc = {
      map_id:            data.map_id,
      creator_id,
      name:              data.name,
      description:       data.description || '',
      era_theme:         data.era_theme   || '',
      background_image_url: '',
      canvas_width:      data.canvas_width ?? 1200,
      canvas_height:     data.canvas_height ?? 700,
      projection_bounds: data.projection_bounds ?? undefined,
      globe_view:        data.globe_view ?? undefined,
      territories:       data.territories,
      connections:       data.connections,
      regions:           data.regions,
      is_public:         true,
      is_moderated:      true,
      moderation_status: 'approved' as 'approved',
      rating:            0,
      rating_count:      0,
      play_count:        0,
    };

    try {
      const existing = await SeederMap.findOne({ map_id: doc.map_id });

      if (existing) {
        await SeederMap.updateOne(
          { map_id: doc.map_id },
          {
            $set: {
              creator_id,
              name:              doc.name,
              description:       doc.description,
              era_theme:         doc.era_theme,
              canvas_width:      doc.canvas_width,
              canvas_height:     doc.canvas_height,
              projection_bounds: doc.projection_bounds,
              globe_view:        doc.globe_view,
              territories:       doc.territories,
              connections:       doc.connections,
              regions:           doc.regions,
              is_public:         true,
              is_moderated:      true,
              moderation_status: 'approved',
            }
          }
        );
        console.log(`  ↻ UPDATED (community):  ${doc.name} [${creator_id}]`);
        updated++;
      } else {
        await SeederMap.create(doc);
        console.log(`  ✓ INSERTED (community): ${doc.name} [${creator_id}]`);
        console.log(`    ${doc.territories.length} territories · ${doc.connections.length} connections · ${doc.regions.length} regions`);
        inserted++;
      }
    } catch (err: any) {
      console.error(`  ✗ ERROR seeding community ${filename}: ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`Seeding complete:`);
  console.log(`  Inserted : ${inserted}`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Skipped  : ${skipped}`);

  // Verify
  const total = await SeederMap.countDocuments();
  console.log(`  Total maps in DB: ${total}`);

  console.log('\nMaps in database:');
  const allMaps = await SeederMap.find({}, 'map_id name era_theme territories connections').lean();
  for (const m of allMaps) {
    const eraTag = m.era_theme ? `[${m.era_theme}]` : '[custom]';
    console.log(`  ${eraTag} ${m.name}`);
    console.log(`    ${(m.territories as any[]).length} territories · ${(m.connections as any[]).length} connections`);
  }

  console.log('\n✅ Done.');

  // Drop stale Redis map payloads (e.g. missing geo_polygon / projection_bounds after schema fixes).
  try {
    const redisUrl = process.env.REDIS_URL
      || (process.env.REDIS_HOST
          ? `redis://:${process.env.REDIS_PASSWORD ?? ''}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT ?? 6379}`
          : 'redis://127.0.0.1:6379');
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    redis.on('error', () => { /* suppress unhandled-error noise before connect */ });
    await redis.connect();
    const allMaps = await SeederMap.find({}, 'map_id').lean();
    for (const m of allMaps as { map_id: string }[]) {
      await redis.del(`map:${m.map_id}`);
    }
    await redis.quit();
    console.log(`  ✓ Cleared Redis map:* cache (${allMaps.length} keys)`);
  } catch {
    console.warn('  ⚠ Redis cache clear skipped (is Redis running?)');
  }

  await mongoose.disconnect();
}

seedMaps().catch(err => {
  console.error('❌ Seeder failed:', err);
  process.exit(1);
});

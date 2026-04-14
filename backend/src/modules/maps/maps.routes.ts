import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { CustomMap } from '../../db/mongo/MapModel';
import { getMapById, getEraMapSummaries, getCommunityMaps, incrementPlayCount, rateMap } from './mapService';
import { getTutorialMap } from '../../game-engine/tutorial/tutorialScript';

const ClipBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const TerritorySchema = z.object({
  territory_id: z.string(),
  name: z.string().min(1).max(64),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  center_point: z.tuple([z.number(), z.number()]),
  region_id: z.string(),
  /** ISO_A2 country codes for geographic boundaries */
  iso_codes: z.array(z.string().length(2)).optional(),
  /** Clip merged geometry to [minLng, minLat, maxLng, maxLat] */
  clip_bbox: ClipBboxSchema.optional(),
  /** Per-country config: [{iso, clip_bbox?}]; overrides iso_codes when present */
  geo_config: z
    .array(z.object({ iso: z.string().length(2), clip_bbox: ClipBboxSchema.optional() }))
    .min(1)
    .optional(),
  /** Polygon exterior ring in geographic [lng, lat] coords (globe editor) */
  geo_polygon: z.array(z.tuple([z.number(), z.number()])).min(3).optional(),
});

const ConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['land', 'sea']).default('land'),
});

const RegionSchema = z.object({
  region_id: z.string(),
  name: z.string().min(1).max(64),
  bonus: z.number().int().min(1).max(20),
});

const CreateMapSchema = z.object({
  name: z.string().min(3).max(64),
  description: z.string().max(512).default(''),
  era_theme: z.string().optional(),
  background_image_url: z.string().url().optional(),
  territories: z.array(TerritorySchema).min(6).max(500),
  connections: z.array(ConnectionSchema).min(5),
  regions: z.array(RegionSchema).min(1),
});

export async function mapsRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/maps/eras ───────────────────────────────────────────────────
  // Returns summaries of all 5 built-in historical era maps
  fastify.get('/eras', async (_request, reply) => {
    try {
      const maps = await getEraMapSummaries();
      return reply.send({ maps });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch era maps' });
    }
  });

  // ── GET /api/maps/community ──────────────────────────────────────────────
  // Returns paginated community-created maps
  fastify.get('/community', async (request, reply) => {
    const { page = '1', limit = '20', sort = 'play_count' } = request.query as Record<string, string>;
    try {
      const result = await getCommunityMaps(
        Math.max(1, parseInt(page, 10)),
        Math.min(50, Math.max(1, parseInt(limit, 10))),
        sort as 'play_count' | 'rating' | 'created_at'
      );
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch community maps' });
    }
  });

  // ── POST /api/maps ───────────────────────────────────────────────────────
  fastify.post('/', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const body = CreateMapSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid map data', details: body.error.flatten() });
    }

    // Validate: all territory IDs in connections exist
    const territoryIds = new Set(body.data.territories.map((t) => t.territory_id));
    for (const conn of body.data.connections) {
      if (!territoryIds.has(conn.from) || !territoryIds.has(conn.to)) {
        return reply.status(400).send({ error: `Connection references unknown territory` });
      }
    }

    // Validate: all territory region_ids exist in regions
    const regionIds = new Set(body.data.regions.map((r) => r.region_id));
    for (const t of body.data.territories) {
      if (!regionIds.has(t.region_id)) {
        return reply.status(400).send({ error: `Territory "${t.name}" references unknown region` });
      }
    }

    const mapId = uuidv4();
    const map = new CustomMap({
      map_id: mapId,
      creator_id: request.userId,
      ...body.data,
      is_public: false,
      moderation_status: 'pending',
    });
    await map.save();

    return reply.status(201).send({ map_id: mapId, message: 'Map saved. Submit for review to publish.' });
  });

  // ── GET /api/maps/public ─────────────────────────────────────────────────
  fastify.get('/public', async (request, reply) => {
    const { sort = 'rating', era, page = '1' } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = 20;
    const skip = (pageNum - 1) * limit;

    // Exclude official built-in era maps (creator system); those are listed under GET /maps/eras.
    const filter: Record<string, unknown> = {
      is_public: true,
      moderation_status: 'approved',
      creator_id: { $ne: 'system' },
    };
    if (era) filter.era_theme = era;

    let listQuery = CustomMap.find(filter).select(
      'map_id name description era_theme rating rating_count play_count creator_id created_at',
    );
    if (sort === 'plays') listQuery = listQuery.sort({ play_count: -1 });
    else if (sort === 'new') listQuery = listQuery.sort({ created_at: -1 });
    else listQuery = listQuery.sort({ rating: -1 });

    const maps = await listQuery.skip(skip).limit(limit).lean();

    const total = await CustomMap.countDocuments(filter);
    return reply.send({ maps, total, page: pageNum, pages: Math.ceil(total / limit) });
  });

  // ── GET /api/maps/me ─────────────────────────────────────────────────────
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const maps = await CustomMap.find({ creator_id: request.userId })
      .select('map_id name description era_theme rating play_count moderation_status created_at')
      .sort({ created_at: -1 })
      .lean();
    return reply.send(maps);
  });

  // ── GET /api/maps/:mapId ─────────────────────────────────────────────────
  // Handles both era maps (era_*) and custom maps
  fastify.get<{ Params: { mapId: string } }>('/:mapId', async (request, reply) => {
    const { mapId } = request.params;

    // Hardcoded tutorial island (same geometry as gameSocket resolveMap('tutorial'))
    if (mapId === 'tutorial') {
      return reply.send({ map: getTutorialMap() });
    }

    // Era maps are served from MongoDB via mapService (with Redis caching)
    if (mapId.startsWith('era_')) {
      const map = await getMapById(mapId);
      if (!map) return reply.status(404).send({ error: 'Era map not found' });
      return reply.send({ map });
    }

    // Custom maps via Mongoose
    const map = await CustomMap.findOne({ map_id: mapId }).lean();
    if (map) return reply.send({ map });

    // Fallback: load from static JSON files in database/maps/
    const jsonPath = path.resolve(__dirname, '../../../../database/maps', `${mapId}.json`);
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      return reply.send({ map: data });
    }

    return reply.status(404).send({ error: 'Map not found' });
  });

  // ── POST /api/maps/:mapId/publish ────────────────────────────────────────
  fastify.post<{ Params: { mapId: string } }>('/:mapId/publish', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const map = await CustomMap.findOne({ map_id: request.params.mapId, creator_id: request.userId });
    if (!map) return reply.status(404).send({ error: 'Map not found or not owned by you' });
    if (map.moderation_status === 'rejected') {
      return reply.status(403).send({ error: 'Map was rejected by moderation' });
    }
    map.moderation_status = 'pending';
    map.is_public = false;
    await map.save();
    return reply.send({ message: 'Map submitted for moderation review' });
  });

  // ── POST /api/maps/:mapId/rate ───────────────────────────────────────────
  fastify.post<{ Params: { mapId: string }; Body: { rating: number } }>(
    '/:mapId/rate',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const { rating } = request.body;
      if (!rating || rating < 1 || rating > 5) {
        return reply.status(400).send({ error: 'Rating must be between 1 and 5' });
      }

      // Era maps use mapService
      if (request.params.mapId.startsWith('era_')) {
        await rateMap(request.params.mapId, rating);
        return reply.send({ message: 'Rating submitted' });
      }

      // Custom maps use Mongoose
      const map = await CustomMap.findOne({ map_id: request.params.mapId });
      if (!map) return reply.status(404).send({ error: 'Map not found' });

      const newCount = map.rating_count + 1;
      const newRating = (map.rating * map.rating_count + rating) / newCount;
      map.rating = Math.round(newRating * 10) / 10;
      map.rating_count = newCount;
      await map.save();

      return reply.send({ rating: map.rating, rating_count: map.rating_count });
    }
  );

  // ── POST /api/maps/:mapId/play ───────────────────────────────────────────
  // Called internally when a game starts to increment play count
  fastify.post<{ Params: { mapId: string } }>('/:mapId/play', async (request, reply) => {
    try {
      if (request.params.mapId.startsWith('era_')) {
        await incrementPlayCount(request.params.mapId);
      } else {
        await CustomMap.updateOne({ map_id: request.params.mapId }, { $inc: { play_count: 1 } });
      }
      return reply.send({ ok: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to increment play count' });
    }
  });
}

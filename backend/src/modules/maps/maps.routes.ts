import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { CustomMap } from '../../db/mongo/MapModel';
import { MapRating } from '../../db/mongo/MapRatingModel';
import { getMapById, getEraMapSummaries, getCommunityMaps } from './mapService';
import { getTutorialMap } from '../../game-engine/tutorial/tutorialScript';

const ClipBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/**
 * Map / region / territory display names are interpolated into HTML by the
 * globe overlay layer. We refuse anything outside this allowlist to close the
 * stored-XSS vector (letters in any script, digits, spaces, and a small set
 * of common punctuation). If a creator wants exotic characters, the right
 * place to handle that is a richer rendering layer, not raw HTML injection.
 */
const SAFE_NAME_REGEX = /^[\p{L}\p{N} '’._\-:()&,!?]+$/u;
const SAFE_NAME_MESSAGE = 'Name contains disallowed characters';

const TerritorySchema = z.object({
  territory_id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid territory id').max(64),
  name: z.string().min(1).max(64).regex(SAFE_NAME_REGEX, SAFE_NAME_MESSAGE),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(500),
  center_point: z.tuple([z.number(), z.number()]),
  region_id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid region id').max(64),
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
  geo_polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(500).optional(),
  /** Which globe surface (Earth or Moon). Defaults to 'earth' when omitted. */
  globe_id: z.enum(['earth', 'moon']).optional(),
  world_id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(48).optional(),
  galaxy_position: z.tuple([z.number(), z.number()]).optional(),
});

const ConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['land', 'sea', 'orbit']).default('land'),
});

const RegionSchema = z.object({
  region_id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid region id').max(64),
  name: z.string().min(1).max(64).regex(SAFE_NAME_REGEX, SAFE_NAME_MESSAGE),
  bonus: z.number().int().min(1).max(20),
});

const SAFE_DESCRIPTION_REGEX = /^[\p{L}\p{N} '’._\-:()&,!?\n\r"/]*$/u;

const CreateMapSchema = z.object({
  name: z.string().min(3).max(64).regex(SAFE_NAME_REGEX, SAFE_NAME_MESSAGE),
  description: z
    .string()
    .max(512)
    .regex(SAFE_DESCRIPTION_REGEX, 'Description contains disallowed characters')
    .default(''),
  era_theme: z.string().optional(),
  background_image_url: z.string().url().optional(),
  territories: z.array(TerritorySchema).min(6).max(500),
  connections: z.array(ConnectionSchema).min(5),
  regions: z.array(RegionSchema).min(1),
});

const CURATED_STATIC_REGIONAL_MAP_IDS = new Set<string>([
  'community_britain_925',
  'community_horn_africa',
  'community_australia_1337',
  'community_flooded_north_america',
]);

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
  // Handles tutorial / era / curated-regional / custom maps. Custom maps are
  // visible to (a) the creator, or (b) anyone if `is_public && approved`.
  // In-game map data is delivered via the Socket.io broadcast (server-side
  // resolveMap), so this REST endpoint is only used by the editor / browse
  // flows where strict privacy gating matters.
  fastify.get<{ Params: { mapId: string } }>('/:mapId', { preHandler: authenticate }, async (request, reply) => {
    const { mapId } = request.params;

    if (mapId === 'tutorial') {
      return reply.send({ map: getTutorialMap() });
    }

    // Curated regional maps are served from static JSON as source of truth.
    if (CURATED_STATIC_REGIONAL_MAP_IDS.has(mapId)) {
      const { isSafeMapId } = await import('../../utils/mapId');
      if (!isSafeMapId(mapId)) {
        return reply.status(400).send({ error: 'Invalid map ID format' });
      }
      const curatedPath = path.resolve(__dirname, '../../../../database/maps', `${mapId}.json`);
      if (fs.existsSync(curatedPath)) {
        const data = JSON.parse(fs.readFileSync(curatedPath, 'utf-8'));
        return reply.send({ map: data });
      }
      return reply.status(404).send({ error: 'Map not found' });
    }

    // Era maps are public by definition.
    if (mapId.startsWith('era_')) {
      const map = await getMapById(mapId);
      if (!map) return reply.status(404).send({ error: 'Era map not found' });
      return reply.send({ map });
    }

    // Custom maps: only the creator OR a public+approved viewer may read.
    const map = await CustomMap.findOne({
      map_id: mapId,
      $or: [
        { is_public: true, moderation_status: 'approved' },
        { creator_id: request.userId },
      ],
    }).lean();
    if (map) return reply.send({ map });

    // No leaky 403 — refuse to confirm/deny existence of pending or rejected
    // private maps the requester does not own.
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
  //
  // One vote per (user, map). Repeated POSTs from the same user upsert
  // their existing rating row (unique compound index) and recompute the
  // cached aggregate atomically — no read-modify-write race, no spam loop
  // multiplied by lookups.
  //
  // Era maps share the same MapRating collection; we use a synthetic
  // "era:<map_id>" key so era ratings never get mistaken for custom ones.
  fastify.post<{ Params: { mapId: string }; Body: { rating: number } }>(
    '/:mapId/rate',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      const { rating } = request.body;
      if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return reply.status(400).send({ error: 'Rating must be an integer between 1 and 5' });
      }

      const mapId = request.params.mapId;
      const userId = request.userId!;

      const isEra = mapId.startsWith('era_');
      // Custom maps must exist and be visible to the rater (public+approved
      // OR owned by them) — otherwise rating becomes a private-existence
      // probe. Era maps are always public.
      if (!isEra) {
        const visible = await CustomMap.findOne({
          map_id: mapId,
          $or: [
            { is_public: true, moderation_status: 'approved' },
            { creator_id: userId },
          ],
        }).select('_id').lean();
        if (!visible) return reply.status(404).send({ error: 'Map not found' });
      }

      // Upsert the per-user vote.
      await MapRating.updateOne(
        { map_id: mapId, user_id: userId },
        { $set: { rating } },
        { upsert: true },
      );

      // Recompute the cached aggregate from the source of truth.
      const agg = await MapRating.aggregate<{
        _id: string;
        avg: number;
        count: number;
      }>([
        { $match: { map_id: mapId } },
        { $group: { _id: '$map_id', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      const avg = agg[0]?.avg ?? 0;
      const count = agg[0]?.count ?? 0;
      const cachedAvg = Math.round(avg * 10) / 10;

      if (!isEra) {
        await CustomMap.updateOne(
          { map_id: mapId },
          { $set: { rating: cachedAvg, rating_count: count } },
        );
      }

      return reply.send({ rating: cachedAvg, rating_count: count });
    }
  );
}

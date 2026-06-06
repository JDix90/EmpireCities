import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import {
  createMap,
  findMapOwnedByUser,
  findMapVisibleToUser,
  getEraMapSummaries,
  getCommunityMaps,
  getMapById,
  invalidateMapCache,
  listMapsByCreator,
  listPublicMapRows,
  rowToGameMap,
  submitMapForModeration,
  updateOwnedMap,
  upsertMapRating,
} from './mapService';
import { getTutorialMap } from '../../game-engine/tutorial/tutorialScript';
import { isMapEditorEnabled, mapEditorDisabledReply } from '../../middleware/mapEditorGate';
import { formatZodError } from '../../utils/formatZodError';

const ClipBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const SAFE_NAME_REGEX = /^[\p{L}\p{N} '’._\-:()&,!?]+$/u;
const SAFE_NAME_MESSAGE = 'Name contains disallowed characters';

const TerritorySchema = z.object({
  territory_id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid territory id').max(64),
  name: z.string().min(1).max(64).regex(SAFE_NAME_REGEX, SAFE_NAME_MESSAGE),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(500),
  center_point: z.tuple([z.number(), z.number()]),
  region_id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid region id').max(64),
  iso_codes: z.array(z.string().length(2)).optional(),
  clip_bbox: ClipBboxSchema.optional(),
  geo_config: z
    .array(z.object({ iso: z.string().length(2), clip_bbox: ClipBboxSchema.optional() }))
    .min(1)
    .optional(),
  geo_polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(500).optional(),
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
  fastify.get('/eras', async (_request, reply) => {
    try {
      const maps = await getEraMapSummaries();
      return reply.send({ maps });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch era maps' });
    }
  });

  fastify.get('/community', async (request, reply) => {
    const { page = '1', limit = '20', sort = 'play_count' } = request.query as Record<string, string>;
    try {
      const result = await getCommunityMaps(
        Math.max(1, parseInt(page, 10)),
        Math.min(50, Math.max(1, parseInt(limit, 10))),
        sort as 'play_count' | 'rating' | 'created_at',
      );
      return reply.send(result);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch community maps' });
    }
  });

  fastify.post('/', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    if (!isMapEditorEnabled()) return mapEditorDisabledReply(reply);

    const body = CreateMapSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(formatZodError(body.error, 'Invalid map data'));
    }

    const territoryIds = new Set(body.data.territories.map((t) => t.territory_id));
    for (const conn of body.data.connections) {
      if (!territoryIds.has(conn.from) || !territoryIds.has(conn.to)) {
        return reply.status(400).send({ error: 'Connection references unknown territory' });
      }
    }

    const regionIds = new Set(body.data.regions.map((r) => r.region_id));
    for (const t of body.data.territories) {
      if (!regionIds.has(t.region_id)) {
        return reply.status(400).send({ error: `Territory "${t.name}" references unknown region` });
      }
    }

    const mapId = uuidv4();
    await createMap({
      map_id: mapId,
      creator_id: request.userId!,
      ...body.data,
      is_public: false,
      moderation_status: 'pending',
    });

    return reply.status(201).send({ map_id: mapId, message: 'Map saved. Submit for review to publish.' });
  });

  fastify.put<{ Params: { mapId: string } }>('/:mapId', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    if (!isMapEditorEnabled()) return mapEditorDisabledReply(reply);

    const { mapId } = request.params;
    if (mapId.startsWith('era_')) {
      return reply.status(403).send({ error: 'Built-in era maps cannot be edited' });
    }

    const body = CreateMapSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(formatZodError(body.error, 'Invalid map data'));
    }

    const territoryIds = new Set(body.data.territories.map((t) => t.territory_id));
    for (const conn of body.data.connections) {
      if (!territoryIds.has(conn.from) || !territoryIds.has(conn.to)) {
        return reply.status(400).send({ error: 'Connection references unknown territory' });
      }
    }

    const regionIds = new Set(body.data.regions.map((r) => r.region_id));
    for (const t of body.data.territories) {
      if (!regionIds.has(t.region_id)) {
        return reply.status(400).send({ error: `Territory "${t.name}" references unknown region` });
      }
    }

    const owned = await findMapOwnedByUser(mapId, request.userId!);
    if (!owned) return reply.status(404).send({ error: 'Map not found or not owned by you' });

    const updated = await updateOwnedMap(mapId, request.userId!, {
      name: body.data.name,
      description: body.data.description,
      territories: body.data.territories,
      connections: body.data.connections,
      regions: body.data.regions,
    });
    if (!updated) return reply.status(404).send({ error: 'Map not found or not owned by you' });

    await invalidateMapCache(mapId);
    return reply.send({ map_id: mapId, message: 'Map updated.' });
  });

  fastify.get('/public', async (request, reply) => {
    const { sort = 'rating', era, page = '1' } = request.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = 20;
    const sortKey = sort === 'plays' ? 'plays' : sort === 'new' ? 'new' : 'rating';

    const { rows, total } = await listPublicMapRows({
      era: era || undefined,
      sort: sortKey,
      page: pageNum,
      limit,
    });

    const maps = rows.map((row) => ({
      map_id: row.map_id,
      name: row.name,
      description: row.description,
      era_theme: row.era_theme,
      rating: Number(row.rating),
      rating_count: row.rating_count,
      play_count: row.play_count,
      creator_id: row.creator_id,
      created_at: row.created_at,
    }));

    return reply.send({ maps, total, page: pageNum, pages: Math.ceil(total / limit) });
  });

  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const rows = await listMapsByCreator(request.userId!);
    const maps = rows.map((row) => ({
      map_id: row.map_id,
      name: row.name,
      description: row.description,
      era_theme: row.era_theme,
      rating: Number(row.rating),
      play_count: row.play_count,
      moderation_status: row.moderation_status,
      created_at: row.created_at,
    }));
    return reply.send(maps);
  });

  fastify.get<{ Params: { mapId: string } }>('/:mapId', { preHandler: authenticate }, async (request, reply) => {
    const { mapId } = request.params;

    if (mapId === 'tutorial') {
      return reply.send({ map: getTutorialMap() });
    }

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

    if (mapId.startsWith('era_')) {
      const map = await getMapById(mapId);
      if (!map) return reply.status(404).send({ error: 'Era map not found' });
      return reply.send({ map });
    }

    const row = await findMapVisibleToUser(mapId, request.userId!);
    if (row) return reply.send({ map: rowToGameMap(row) });

    return reply.status(404).send({ error: 'Map not found' });
  });

  fastify.post<{ Params: { mapId: string } }>(
    '/:mapId/publish',
    { preHandler: [authenticate, rejectGuest] },
    async (request, reply) => {
      if (!isMapEditorEnabled()) return mapEditorDisabledReply(reply);

      const map = await findMapOwnedByUser(request.params.mapId, request.userId!);
      if (!map) return reply.status(404).send({ error: 'Map not found or not owned by you' });
      if (map.moderation_status === 'rejected') {
        return reply.status(403).send({ error: 'Map was rejected by moderation' });
      }
      await submitMapForModeration(request.params.mapId, request.userId!);
      await invalidateMapCache(request.params.mapId);
      return reply.send({ message: 'Map submitted for moderation review' });
    },
  );

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

      if (!isEra) {
        const visible = await findMapVisibleToUser(mapId, userId);
        if (!visible) return reply.status(404).send({ error: 'Map not found' });
      }

      const result = await upsertMapRating(mapId, userId, rating, !isEra);
      if (!isEra) await invalidateMapCache(mapId);

      return reply.send(result);
    },
  );
}

/**
 * PostgreSQL map storage — replaces MongoDB custommaps + MapRating collections.
 * Territories, connections, and regions are stored as JSONB arrays; optional
 * globe/metadata fields use JSONB where structured.
 */

import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from './index';
import type {
  Connection,
  GameMap,
  MapSummary,
  Region,
  Territory,
} from '../../modules/maps/mapTypes';

export interface MapRow {
  map_id: string;
  creator_id: string;
  name: string;
  description: string;
  era_theme: string | null;
  background_image_url: string | null;
  canvas_width: number;
  canvas_height: number;
  projection_bounds: GameMap['projection_bounds'] | null;
  globe_view: GameMap['globe_view'] | null;
  map_kind: GameMap['map_kind'] | null;
  worlds: GameMap['worlds'] | null;
  orbit_access: GameMap['orbit_access'] | null;
  rts_terrain: unknown;
  territories: Territory[];
  connections: Connection[];
  regions: Region[];
  is_public: boolean;
  is_moderated: boolean;
  moderation_status: string;
  rating: number;
  rating_count: number;
  play_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateMapInput {
  map_id: string;
  creator_id: string;
  name: string;
  description?: string;
  era_theme?: string;
  background_image_url?: string;
  canvas_width?: number;
  canvas_height?: number;
  projection_bounds?: GameMap['projection_bounds'];
  globe_view?: GameMap['globe_view'];
  map_kind?: GameMap['map_kind'];
  worlds?: GameMap['worlds'];
  orbit_access?: GameMap['orbit_access'];
  rts_terrain?: unknown;
  territories: Territory[];
  connections: Connection[];
  regions: Region[];
  is_public?: boolean;
  is_moderated?: boolean;
  moderation_status?: 'pending' | 'approved' | 'rejected';
  rating?: number;
  rating_count?: number;
  play_count?: number;
}

const MAP_SELECT = `
  map_id, creator_id, name, description, era_theme, background_image_url,
  canvas_width, canvas_height, projection_bounds, globe_view, map_kind, worlds,
  orbit_access, rts_terrain, territories, connections, regions,
  is_public, is_moderated, moderation_status, rating, rating_count, play_count,
  created_at, updated_at
`;

export function rowToGameMap(row: MapRow): GameMap {
  return {
    map_id: row.map_id,
    name: row.name,
    description: row.description ?? '',
    era_theme: (row.era_theme ?? 'custom') as GameMap['era_theme'],
    canvas_width: row.canvas_width,
    canvas_height: row.canvas_height,
    projection_bounds: row.projection_bounds ?? undefined,
    globe_view: row.globe_view ?? undefined,
    map_kind: row.map_kind ?? undefined,
    worlds: row.worlds ?? undefined,
    orbit_access: row.orbit_access ?? undefined,
    territories: row.territories,
    connections: row.connections,
    regions: row.regions,
    is_public: row.is_public,
    moderation_status: row.moderation_status,
    creator_id: row.creator_id,
    play_count: row.play_count,
    rating_sum: (row.rating ?? 0) * (row.rating_count ?? 0),
    rating_count: row.rating_count,
    created_at: row.created_at,
  };
}

function rowToSummary(row: Pick<MapRow, 'map_id' | 'name' | 'description' | 'era_theme' | 'territories' | 'regions' | 'is_public' | 'play_count' | 'rating' | 'rating_count' | 'creator_id'>): MapSummary {
  return {
    map_id: row.map_id,
    name: row.name,
    description: row.description ?? '',
    era_theme: row.era_theme ?? 'custom',
    territory_count: row.territories.length,
    region_count: row.regions.length,
    is_public: row.is_public,
    play_count: row.play_count ?? 0,
    avg_rating: Number(row.rating ?? 0),
    creator_id: row.creator_id,
  };
}

export async function getMapRowById(mapId: string): Promise<MapRow | null> {
  return queryOne<MapRow>(`SELECT ${MAP_SELECT} FROM maps WHERE map_id = $1`, [mapId]);
}

export async function getMapByIdFromDb(mapId: string): Promise<GameMap | null> {
  const row = await getMapRowById(mapId);
  return row ? rowToGameMap(row) : null;
}

export async function createMap(input: CreateMapInput): Promise<void> {
  await query(
    `INSERT INTO maps (
      map_id, creator_id, name, description, era_theme, background_image_url,
      canvas_width, canvas_height, projection_bounds, globe_view, map_kind, worlds,
      orbit_access, rts_terrain, territories, connections, regions,
      is_public, is_moderated, moderation_status, rating, rating_count, play_count
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb,
      $13, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
      $18, $19, $20, $21, $22, $23
    )`,
    [
      input.map_id,
      input.creator_id,
      input.name,
      input.description ?? '',
      input.era_theme ?? null,
      input.background_image_url ?? null,
      input.canvas_width ?? 1200,
      input.canvas_height ?? 700,
      input.projection_bounds ? JSON.stringify(input.projection_bounds) : null,
      input.globe_view ? JSON.stringify(input.globe_view) : null,
      input.map_kind ?? null,
      input.worlds ? JSON.stringify(input.worlds) : null,
      input.orbit_access ?? null,
      input.rts_terrain ? JSON.stringify(input.rts_terrain) : null,
      JSON.stringify(input.territories),
      JSON.stringify(input.connections),
      JSON.stringify(input.regions),
      input.is_public ?? false,
      input.is_moderated ?? false,
      input.moderation_status ?? 'pending',
      input.rating ?? 0,
      input.rating_count ?? 0,
      input.play_count ?? 0,
    ],
  );
}

export async function upsertSeedMap(input: CreateMapInput): Promise<'inserted' | 'updated'> {
  const existing = await getMapRowById(input.map_id);
  if (!existing) {
    await createMap(input);
    return 'inserted';
  }

  await query(
    `UPDATE maps SET
      name = $2,
      description = $3,
      era_theme = $4,
      canvas_width = $5,
      canvas_height = $6,
      projection_bounds = $7::jsonb,
      globe_view = $8::jsonb,
      map_kind = $9,
      worlds = $10::jsonb,
      orbit_access = $11,
      rts_terrain = $12::jsonb,
      territories = $13::jsonb,
      connections = $14::jsonb,
      regions = $15::jsonb,
      is_public = $16,
      is_moderated = $17,
      moderation_status = $18,
      updated_at = NOW()
    WHERE map_id = $1`,
    [
      input.map_id,
      input.name,
      input.description ?? '',
      input.era_theme ?? null,
      input.canvas_width ?? 1200,
      input.canvas_height ?? 700,
      input.projection_bounds ? JSON.stringify(input.projection_bounds) : null,
      input.globe_view ? JSON.stringify(input.globe_view) : null,
      input.map_kind ?? null,
      input.worlds ? JSON.stringify(input.worlds) : null,
      input.orbit_access ?? null,
      input.rts_terrain ? JSON.stringify(input.rts_terrain) : null,
      JSON.stringify(input.territories),
      JSON.stringify(input.connections),
      JSON.stringify(input.regions),
      input.is_public ?? true,
      input.is_moderated ?? true,
      input.moderation_status ?? 'approved',
    ],
  );
  return 'updated';
}

export async function listEraMapRows(): Promise<MapRow[]> {
  return query<MapRow>(
    `SELECT ${MAP_SELECT} FROM maps
     WHERE creator_id = 'system' AND moderation_status = 'approved'
     ORDER BY name ASC`,
  );
}

export async function listCommunityMapRows(
  page: number,
  limit: number,
  sortBy: 'play_count' | 'rating' | 'created_at',
): Promise<{ rows: MapRow[]; total: number }> {
  const sortColumn =
    sortBy === 'rating' ? 'rating' : sortBy === 'created_at' ? 'created_at' : 'play_count';
  const offset = (page - 1) * limit;

  const [rows, totalRow] = await Promise.all([
    query<MapRow>(
      `SELECT ${MAP_SELECT} FROM maps
       WHERE creator_id <> 'system' AND is_public = true AND moderation_status = 'approved'
       ORDER BY ${sortColumn} DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM maps
       WHERE creator_id <> 'system' AND is_public = true AND moderation_status = 'approved'`,
    ),
  ]);

  return { rows, total: parseInt(totalRow?.count ?? '0', 10) };
}

export async function listPublicMapRows(options: {
  era?: string;
  sort: 'rating' | 'plays' | 'new';
  page: number;
  limit: number;
}): Promise<{ rows: MapRow[]; total: number }> {
  const { era, sort, page, limit } = options;
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  const filters = [`is_public = true`, `moderation_status = 'approved'`, `creator_id <> 'system'`];
  if (era) {
    params.push(era);
    filters.push(`era_theme = $${params.length}`);
  }
  const where = filters.join(' AND ');
  const orderBy =
    sort === 'plays' ? 'play_count DESC' : sort === 'new' ? 'created_at DESC' : 'rating DESC';

  const [rows, totalRow] = await Promise.all([
    query<MapRow>(
      `SELECT map_id, creator_id, name, description, era_theme, background_image_url,
              canvas_width, canvas_height, projection_bounds, globe_view, map_kind, worlds,
              orbit_access, rts_terrain, territories, connections, regions,
              is_public, is_moderated, moderation_status, rating, rating_count, play_count,
              created_at, updated_at
       FROM maps WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM maps WHERE ${where}`, params),
  ]);

  return { rows, total: parseInt(totalRow?.count ?? '0', 10) };
}

export async function listMapsByCreator(creatorId: string): Promise<MapRow[]> {
  return query<MapRow>(
    `SELECT map_id, creator_id, name, description, era_theme, background_image_url,
            canvas_width, canvas_height, projection_bounds, globe_view, map_kind, worlds,
            orbit_access, rts_terrain, territories, connections, regions,
            is_public, is_moderated, moderation_status, rating, rating_count, play_count,
            created_at, updated_at
     FROM maps WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId],
  );
}

export async function findMapVisibleToUser(mapId: string, userId: string): Promise<MapRow | null> {
  return queryOne<MapRow>(
    `SELECT ${MAP_SELECT} FROM maps
     WHERE map_id = $1
       AND (
         (is_public = true AND moderation_status = 'approved')
         OR creator_id = $2
       )`,
    [mapId, userId],
  );
}

export async function findMapOwnedByUser(mapId: string, creatorId: string): Promise<MapRow | null> {
  return queryOne<MapRow>(
    `SELECT ${MAP_SELECT} FROM maps WHERE map_id = $1 AND creator_id = $2`,
    [mapId, creatorId],
  );
}

export async function submitMapForModeration(mapId: string, creatorId: string): Promise<boolean> {
  const result = await query<{ map_id: string }>(
    `UPDATE maps SET moderation_status = 'pending', is_public = false, updated_at = NOW()
     WHERE map_id = $1 AND creator_id = $2
     RETURNING map_id`,
    [mapId, creatorId],
  );
  return result.length > 0;
}

export async function incrementMapPlayCount(mapId: string): Promise<void> {
  await query(
    `UPDATE maps SET play_count = play_count + 1, updated_at = NOW() WHERE map_id = $1`,
    [mapId],
  );
}

export async function upsertMapRating(
  mapId: string,
  userId: string,
  rating: number,
  updateCustomMapAggregate: boolean,
): Promise<{ rating: number; rating_count: number }> {
  return withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO map_ratings (map_id, user_id, rating, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (map_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
      [mapId, userId, rating],
    );

    const agg = await client.query<{ avg: string; count: string }>(
      `SELECT COALESCE(AVG(rating), 0)::text AS avg, COUNT(*)::text AS count
       FROM map_ratings WHERE map_id = $1`,
      [mapId],
    );
    const avg = parseFloat(agg.rows[0]?.avg ?? '0');
    const count = parseInt(agg.rows[0]?.count ?? '0', 10);
    const cachedAvg = Math.round(avg * 10) / 10;

    if (updateCustomMapAggregate) {
      await client.query(
        `UPDATE maps SET rating = $2, rating_count = $3, updated_at = NOW() WHERE map_id = $1`,
        [mapId, cachedAvg, count],
      );
    }

    return { rating: cachedAvg, rating_count: count };
  });
}

export { rowToSummary };

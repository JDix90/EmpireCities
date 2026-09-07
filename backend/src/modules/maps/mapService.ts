/**
 * Borderfall — Map Service
 * Map documents live in PostgreSQL (JSONB). Redis caches hot reads.
 */

import { getRedis } from '../../db/redis';
import {
  getMapByIdFromDb,
  incrementMapPlayCount,
  listEraMapRows,
  rowToSummary,
} from '../../db/postgres/mapsRepository';
import type { GameMap, MapSummary } from './mapTypes';

export type { Connection, GameMap, MapSummary, Region, Territory } from './mapTypes';

const MAP_CACHE_TTL = 1800;

export async function getMapById(mapId: string): Promise<GameMap | null> {
  const redis = getRedis();
  const cacheKey = `map:${mapId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as GameMap;
    }
  } catch {
    console.warn('[MapService] Redis cache miss, falling back to PostgreSQL');
  }

  const map = await getMapByIdFromDb(mapId);
  if (map) {
    try {
      await redis.setex(cacheKey, MAP_CACHE_TTL, JSON.stringify(map));
    } catch {
      /* non-fatal */
    }
  }

  return map;
}

export async function invalidateMapCache(mapId: string): Promise<void> {
  try {
    await getRedis().del(`map:${mapId}`);
  } catch {
    /* non-fatal */
  }
}

export async function getEraMapSummaries(): Promise<MapSummary[]> {
  const rows = await listEraMapRows();
  return rows.map(rowToSummary);
}

export async function incrementPlayCount(mapId: string): Promise<void> {
  await incrementMapPlayCount(mapId);
  await invalidateMapCache(mapId);
}

// Re-export repository helpers used by routes
export {
  createMap,
  findMapOwnedByUser,
  findMapVisibleToUser,
  listMapsByCreator,
  listPublicMapRows,
  rowToGameMap,
  submitMapForModeration,
  updateOwnedMap,
  upsertMapRating,
} from '../../db/postgres/mapsRepository';

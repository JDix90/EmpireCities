/**
 * Borderfall — Map Service
 * Map documents live in PostgreSQL (JSONB). Redis caches hot reads.
 */

import { getRedis } from '../../db/redis';
import {
  findMapCreatorUserId,
  getMapByIdFromDb,
  incrementMapPlayCount,
  listEraMapRows,
  rowToSummary,
} from '../../db/postgres/mapsRepository';
import { grantAchievementsOutsideGame } from '../../game-engine/achievements/achievementService';
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

/** Games started on a player's map that earn its maker Popular Creator. */
export const POPULAR_CREATOR_PLAYS = 100;

export async function incrementPlayCount(mapId: string): Promise<void> {
  const counted = await incrementMapPlayCount(mapId);
  await invalidateMapCache(mapId);
  // At or past the mark rather than on it, so a map already past it when this
  // shipped still earns it with its next game. Granted once; later games find
  // the row there.
  if (counted?.creator_user_id && counted.play_count >= POPULAR_CREATOR_PLAYS) {
    await grantAchievementsOutsideGame(counted.creator_user_id, ['popular_creator']);
  }
}

/** Map Maker: a player's map is approved, which lists it in the hub. */
export async function grantMapMaker(mapId: string): Promise<void> {
  const creatorId = await findMapCreatorUserId(mapId);
  if (creatorId) await grantAchievementsOutsideGame(creatorId, ['map_maker']);
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

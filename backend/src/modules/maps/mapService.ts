/**
 * Borderfall — Map Service
 * Map documents live in PostgreSQL (JSONB). Redis caches hot reads.
 */

import { getRedis } from '../../db/redis';
import {
  getMapByIdFromDb,
  incrementMapPlayCount,
  listCommunityMapRows,
  listEraMapRows,
  rowToSummary,
} from '../../db/postgres/mapsRepository';
import type { GameMap, MapSummary, Territory } from './mapTypes';

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

export async function getCommunityMaps(
  page: number = 1,
  limit: number = 20,
  sortBy: 'play_count' | 'rating' | 'created_at' = 'play_count',
): Promise<{ maps: MapSummary[]; total: number }> {
  const { rows, total } = await listCommunityMapRows(page, limit, sortBy);
  return { maps: rows.map(rowToSummary), total };
}

export function buildAdjacencyGraph(map: GameMap): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const t of map.territories) {
    graph.set(t.territory_id, new Set());
  }
  for (const c of map.connections) {
    graph.get(c.from)?.add(c.to);
    graph.get(c.to)?.add(c.from);
  }
  return graph;
}

export function getTerritoriesByRegion(map: GameMap): Map<string, Territory[]> {
  const regionMap = new Map<string, Territory[]>();
  for (const r of map.regions) {
    regionMap.set(r.region_id, []);
  }
  for (const t of map.territories) {
    regionMap.get(t.region_id)?.push(t);
  }
  return regionMap;
}

export function calculateRegionBonuses(map: GameMap, ownedTerritories: Set<string>): number {
  const regionMap = getTerritoriesByRegion(map);
  let totalBonus = 0;
  for (const region of map.regions) {
    const regionTerritories = regionMap.get(region.region_id) || [];
    const ownsAll = regionTerritories.every((t) => ownedTerritories.has(t.territory_id));
    if (ownsAll && regionTerritories.length > 0) {
      totalBonus += region.bonus;
    }
  }
  return totalBonus;
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
  upsertMapRating,
  upsertSeedMap,
} from '../../db/postgres/mapsRepository';

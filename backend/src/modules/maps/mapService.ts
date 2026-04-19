/**
 * Eras of Empire — Map Service
 * Provides map data retrieval and caching for the game engine.
 * Maps are loaded from MongoDB and cached in Redis for fast access.
 */

import { getDb } from '../../db/mongo';
import { getRedis } from '../../db/redis';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface Territory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  /** WGS84 ring — globe uses this when set */
  geo_polygon?: [number, number][];
  /** Which globe surface (Earth or Moon). Defaults to 'earth'. */
  globe_id?: 'earth' | 'moon';
}

export interface Connection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

export interface Region {
  region_id: string;
  name: string;
  bonus: number;
}

export interface GameMap {
  map_id: string;
  name: string;
  description: string;
  era_theme: 'ancient' | 'medieval' | 'discovery' | 'ww2' | 'coldwar' | 'modern' | 'acw' | 'risorgimento' | 'space_age' | 'custom';
  canvas_width: number;
  canvas_height: number;
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  globe_view?: {
    lock_rotation?: boolean;
    center_lat?: number;
    center_lng?: number;
    altitude?: number;
  };
  territories: Territory[];
  connections: Connection[];
  regions: Region[];
  is_public: boolean;
  moderation_status: string;
  creator_id: string;
  play_count: number;
  rating_sum: number;
  rating_count: number;
  created_at: Date;
}

export interface MapSummary {
  map_id: string;
  name: string;
  description: string;
  era_theme: string;
  territory_count: number;
  region_count: number;
  is_public: boolean;
  play_count: number;
  avg_rating: number;
  creator_id: string;
}

// Cache TTL: 30 minutes for map data (maps rarely change)
const MAP_CACHE_TTL = 1800;

// ─── Get a single map by ID ───────────────────────────────────────────────────
export async function getMapById(mapId: string): Promise<GameMap | null> {
  const redis = getRedis();
  const cacheKey = `map:${mapId}`;

  // Try Redis cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as GameMap;
    }
  } catch (err) {
    // Redis unavailable — fall through to MongoDB
    console.warn('[MapService] Redis cache miss, falling back to MongoDB');
  }

  // Fetch from MongoDB
  const db = getDb();
  const map = await db.collection('custommaps').findOne(
    { map_id: mapId },
    { projection: { _id: 0 } }
  ) as GameMap | null;

  if (map) {
    // Cache in Redis
    try {
      await redis.setex(cacheKey, MAP_CACHE_TTL, JSON.stringify(map));
    } catch {
      // Non-fatal
    }
  }

  return map;
}

// ─── Get all built-in era maps ───────────────────────────────────────────────
export async function getEraMapSummaries(): Promise<MapSummary[]> {
  const db = getDb();
  const maps = await db.collection('custommaps').find(
    { creator_id: 'system', moderation_status: 'approved' },
    {
      projection: {
        _id: 0,
        map_id: 1,
        name: 1,
        description: 1,
        era_theme: 1,
        territories: 1,
        regions: 1,
        is_public: 1,
        play_count: 1,
        rating: 1,
        rating_count: 1,
        creator_id: 1,
      }
    }
  ).toArray();

  return maps.map((m: (typeof maps)[number]) => ({
    map_id:          m.map_id,
    name:            m.name,
    description:     m.description,
    era_theme:       m.era_theme,
    territory_count: (m.territories as Territory[]).length,
    region_count:    (m.regions as Region[]).length,
    is_public:       m.is_public,
    play_count:      m.play_count || 0,
    avg_rating:      (m as { rating?: number; rating_count?: number }).rating ?? 0,
    creator_id:      m.creator_id,
  }));
}

// ─── Get community maps (paginated) ──────────────────────────────────────────
export async function getCommunityMaps(
  page: number = 1,
  limit: number = 20,
  sortBy: 'play_count' | 'rating' | 'created_at' = 'play_count'
): Promise<{ maps: MapSummary[]; total: number }> {
  const db = getDb();
  const skip = (page - 1) * limit;

  const sortField = sortBy === 'rating' ? 'rating' : sortBy;

  const [maps, total] = await Promise.all([
    db.collection('custommaps').find(
      { creator_id: { $ne: 'system' }, is_public: true, moderation_status: 'approved' },
      {
        projection: {
          _id: 0,
          map_id: 1, name: 1, description: 1, era_theme: 1,
          territories: 1, regions: 1, is_public: 1,
          play_count: 1, rating: 1, rating_count: 1, creator_id: 1,
        }
      }
    ).sort({ [sortField]: -1 }).skip(skip).limit(limit).toArray(),

    db.collection('custommaps').countDocuments({
      creator_id: { $ne: 'system' }, is_public: true, moderation_status: 'approved'
    }),
  ]);

  return {
    maps: maps.map((m: (typeof maps)[number]) => ({
      map_id:          m.map_id,
      name:            m.name,
      description:     m.description,
      era_theme:       m.era_theme,
      territory_count: (m.territories as Territory[]).length,
      region_count:    (m.regions as Region[]).length,
      is_public:       m.is_public,
      play_count:      m.play_count || 0,
      avg_rating:      (m as { rating?: number }).rating ?? 0,
      creator_id:      m.creator_id,
    })),
    total,
  };
}

// ─── Build adjacency graph from connections ───────────────────────────────────
export function buildAdjacencyGraph(map: GameMap): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Initialize all territories
  for (const t of map.territories) {
    graph.set(t.territory_id, new Set());
  }

  // Add bidirectional connections
  for (const c of map.connections) {
    graph.get(c.from)?.add(c.to);
    graph.get(c.to)?.add(c.from);
  }

  return graph;
}

// ─── Get territories belonging to a region ───────────────────────────────────
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

// ─── Calculate region bonus for a player ─────────────────────────────────────
export function calculateRegionBonuses(
  map: GameMap,
  ownedTerritories: Set<string>
): number {
  const regionMap = getTerritoriesByRegion(map);
  let totalBonus = 0;

  for (const region of map.regions) {
    const regionTerritories = regionMap.get(region.region_id) || [];
    const ownsAll = regionTerritories.every(t => ownedTerritories.has(t.territory_id));
    if (ownsAll && regionTerritories.length > 0) {
      totalBonus += region.bonus;
    }
  }

  return totalBonus;
}

// ─── Increment play count ─────────────────────────────────────────────────────
export async function incrementPlayCount(mapId: string): Promise<void> {
  const db = getDb();
  await db.collection('custommaps').updateOne(
    { map_id: mapId },
    { $inc: { play_count: 1 } }
  );

  // Invalidate cache
  const redis = getRedis();
  try {
    await redis.del(`map:${mapId}`);
  } catch {
    // Non-fatal
  }
}

// ─── Submit a rating ──────────────────────────────────────────────────────────
export async function rateMap(mapId: string, rating: number): Promise<void> {
  if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

  const db = getDb();
  const doc = await db.collection('custommaps').findOne({ map_id: mapId }, { projection: { rating: 1, rating_count: 1 } });
  if (doc) {
    const r = doc as unknown as { rating: number; rating_count: number };
    const newCount = (r.rating_count || 0) + 1;
    const newRating = ((r.rating || 0) * (r.rating_count || 0) + rating) / newCount;
    await db.collection('custommaps').updateOne(
      { map_id: mapId },
      { $set: { rating: Math.round(newRating * 10) / 10, rating_count: newCount } }
    );
  }

  // Invalidate cache
  const redis = getRedis();
  try {
    await redis.del(`map:${mapId}`);
  } catch {
    // Non-fatal
  }
}

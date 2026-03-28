/**
 * ChronoConquest — Frontend Map Service
 * Fetches map data from the backend API and provides type-safe access.
 */

import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Territory {
  territory_id: string;
  name: string;
  polygon: [number, number][];
  center_point: [number, number];
  region_id: string;
}

export interface Connection {
  from: string;
  to: string;
  type: 'land' | 'sea';
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
  era_theme: 'ancient' | 'medieval' | 'discovery' | 'ww2' | 'coldwar' | 'custom';
  canvas_width: number;
  canvas_height: number;
  territories: Territory[];
  connections: Connection[];
  regions: Region[];
  is_public: boolean;
  play_count: number;
  creator_id: string;
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

// ─── Era metadata for UI display ──────────────────────────────────────────────

export const ERA_METADATA: Record<string, {
  label: string;
  year: string;
  color: string;
  bgColor: string;
  description: string;
}> = {
  ancient: {
    label: 'Ancient World',
    year: '200 AD',
    color: '#D4A017',
    bgColor: '#2C1810',
    description: 'Command the legions of Rome, the cavalry of Parthia, or the armies of Han China.',
  },
  medieval: {
    label: 'Medieval World',
    year: '1200 AD',
    color: '#8B4513',
    bgColor: '#1A1A2E',
    description: 'Lead the Mongol hordes, defend the Holy Land, or build a Silk Road empire.',
  },
  discovery: {
    label: 'Age of Discovery',
    year: '1600 AD',
    color: '#1E8449',
    bgColor: '#0D2137',
    description: 'Command the Spanish Armada, Portuguese spice fleets, or Ottoman janissaries.',
  },
  ww2: {
    label: 'World War II',
    year: '1939–1945',
    color: '#566573',
    bgColor: '#1C1C1C',
    description: 'Lead the Wehrmacht, Allied forces, Soviet Red Army, or Imperial Japan.',
  },
  coldwar: {
    label: 'Cold War',
    year: '1947–1991',
    color: '#1F618D',
    bgColor: '#0A0A1A',
    description: 'Command NATO or the Warsaw Pact, fight proxy wars, or play the Non-Aligned Movement.',
  },
};

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Fetch all built-in era map summaries.
 */
export async function fetchEraMaps(): Promise<MapSummary[]> {
  const response = await api.get<{ maps: MapSummary[] }>('/maps/eras');
  return response.data.maps;
}

/**
 * Fetch full map data including territories, connections, and regions.
 */
export async function fetchMapById(mapId: string): Promise<GameMap> {
  const response = await api.get<{ map: GameMap }>(`/maps/${mapId}`);
  return response.data.map;
}

/**
 * Fetch community maps (paginated).
 */
export async function fetchCommunityMaps(
  page: number = 1,
  limit: number = 20,
  sort: 'play_count' | 'rating' | 'created_at' = 'play_count'
): Promise<{ maps: MapSummary[]; total: number }> {
  const response = await api.get<{ maps: MapSummary[]; total: number }>(
    `/maps/community?page=${page}&limit=${limit}&sort=${sort}`
  );
  return response.data;
}

/**
 * Submit a rating for a map.
 */
export async function rateMap(mapId: string, rating: number): Promise<void> {
  await api.post(`/maps/${mapId}/rate`, { rating });
}

// ─── Client-side map utilities ────────────────────────────────────────────────

/**
 * Build an adjacency graph from a map's connections list.
 */
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

/**
 * Get the territory object by ID.
 */
export function getTerritoryById(map: GameMap, id: string): Territory | undefined {
  return map.territories.find(t => t.territory_id === id);
}

/**
 * Get all territories in a region.
 */
export function getTerritoriesInRegion(map: GameMap, regionId: string): Territory[] {
  return map.territories.filter(t => t.region_id === regionId);
}

/**
 * Check if two territories are adjacent.
 */
export function areAdjacent(map: GameMap, fromId: string, toId: string): boolean {
  return map.connections.some(
    c => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
  );
}

/**
 * Scale polygon coordinates from map canvas to screen dimensions.
 * Uses uniform scaling (scale-to-fit) to preserve aspect ratio and avoid distortion.
 */
export function scalePolygon(
  polygon: [number, number][],
  canvasWidth: number,
  canvasHeight: number,
  screenWidth: number,
  screenHeight: number
): [number, number][] {
  const scale = Math.min(screenWidth / canvasWidth, screenHeight / canvasHeight);
  const offsetX = (screenWidth  - canvasWidth  * scale) / 2;
  const offsetY = (screenHeight - canvasHeight * scale) / 2;
  return polygon.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]);
}

/**
 * Scale a single point from map canvas to screen dimensions.
 * Uses uniform scaling (scale-to-fit) to preserve aspect ratio.
 */
export function scalePoint(
  point: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  screenWidth: number,
  screenHeight: number
): [number, number] {
  const scale = Math.min(screenWidth / canvasWidth, screenHeight / canvasHeight);
  const offsetX = (screenWidth  - canvasWidth  * scale) / 2;
  const offsetY = (screenHeight - canvasHeight * scale) / 2;
  return [
    point[0] * scale + offsetX,
    point[1] * scale + offsetY,
  ];
}

import { inferWorldId } from '@borderfall/shared';

/**
 * Split a 2D map document into one renderable document per world.
 *
 * The Space Age map authors its 9 lunar tiles in the SAME canvas coordinate
 * space as Earth (both span roughly 0-1200 × 0-800), and gives them
 * Earth-referenced `geo_polygon` values that are placeholders rather than
 * selenographic coordinates. The 2D map had no world filter at all, so it drew
 * Mare Imbrium over the Caribbean, Mare Nubium over the South Atlantic and the
 * Far Side tiles over Australia and Siberia. The globe never had this problem
 * because it filters by `activeWorldId` and renders a separate Moon inset.
 *
 * Each partition keeps only the territories of its world, the connections whose
 * BOTH endpoints are in that world (an orbit lane spans two worlds and is drawn
 * separately as a stub), and the regions that still have a territory.
 */

export interface WorldPartitionTerritory {
  territory_id: string;
  region_id: string;
  world_id?: string;
  globe_id?: string;
  polygon: Array<[number, number]>;
  [key: string]: unknown;
}

export interface WorldPartitionMap {
  canvas_width?: number;
  canvas_height?: number;
  projection_bounds?: unknown;
  territories: WorldPartitionTerritory[];
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit'; source?: 'launch_pad' }>;
  regions?: Array<{ region_id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Geo hints that make `GameMap` take the Natural Earth projection path. */
const GEO_FIELDS = ['geo_polygon', 'geo_multipolygon', 'iso_codes', 'geo_config', 'admin1'] as const;

/**
 * The map as it should render for one world. For any world other than Earth the
 * geo hints and the authored canvas size are stripped: the lunar `geo_polygon`s
 * are Earth lat/lng placeholders that would project the Moon back onto Europe,
 * and dropping `canvas_width`/`canvas_height` lets GameMap fall back to the
 * bounding box of the tiles it was actually given, so the Moon fills its inset.
 */
export function filterMapToWorld<T extends WorldPartitionMap>(mapData: T, worldId: string): T {
  const territories = mapData.territories.filter((t) => inferWorldId(t) === worldId);
  if (territories.length === mapData.territories.length && worldId === 'earth') return mapData;

  const ids = new Set(territories.map((t) => t.territory_id));
  const isEarth = worldId === 'earth';
  const projected = isEarth
    ? territories
    : territories.map((t) => {
        const copy = { ...t } as WorldPartitionTerritory;
        for (const field of GEO_FIELDS) delete copy[field];
        return copy;
      });

  const out = {
    ...mapData,
    territories: projected,
    connections: mapData.connections.filter((c) => ids.has(c.from) && ids.has(c.to)),
    regions: mapData.regions?.filter((r) =>
      territories.some((t) => t.region_id === r.region_id),
    ) ?? mapData.regions,
  } as T;

  if (!isEarth) {
    delete (out as WorldPartitionMap).canvas_width;
    delete (out as WorldPartitionMap).canvas_height;
    delete (out as WorldPartitionMap).projection_bounds;
  }
  return out;
}

/** World ids present on this map, Earth first, in first-appearance order. */
export function worldIdsOnMap(mapData: Pick<WorldPartitionMap, 'territories'>): string[] {
  const seen: string[] = [];
  for (const t of mapData.territories) {
    const wid = inferWorldId(t);
    if (!seen.includes(wid)) seen.push(wid);
  }
  return seen.sort((a, b) => (a === 'earth' ? -1 : b === 'earth' ? 1 : a.localeCompare(b)));
}

export interface OrbitStub {
  /** The endpoint that lives on the world being rendered. */
  fromId: string;
  /** The endpoint on the other world. */
  toId: string;
  toWorldId: string;
  source?: 'launch_pad';
}

/**
 * Orbit lanes with exactly one endpoint on this world. They cannot be drawn as
 * a line — the other end is on a different canvas — so the map draws each as a
 * short stub off its endpoint. Previously orbit connections were drawn in the
 * same colour as a land border between two tiles that are nowhere near each
 * other, which read as a rendering fault.
 */
export function orbitStubsForWorld(mapData: WorldPartitionMap, worldId: string): OrbitStub[] {
  const worldOf = new Map(mapData.territories.map((t) => [t.territory_id, inferWorldId(t)]));
  const stubs: OrbitStub[] = [];
  for (const c of mapData.connections) {
    if (c.type !== 'orbit') continue;
    const fromWorld = worldOf.get(c.from);
    const toWorld = worldOf.get(c.to);
    if (fromWorld === undefined || toWorld === undefined) continue;
    if (fromWorld === worldId && toWorld !== worldId) {
      stubs.push({ fromId: c.from, toId: c.to, toWorldId: toWorld, source: c.source });
    } else if (toWorld === worldId && fromWorld !== worldId) {
      stubs.push({ fromId: c.to, toId: c.from, toWorldId: fromWorld, source: c.source });
    }
  }
  return stubs;
}

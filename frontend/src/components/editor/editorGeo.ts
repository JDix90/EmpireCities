/**
 * Geometry for the map editor: which territories touch, how islands reach the
 * mainland, whether a drawn outline overlaps or crosses itself, and the
 * region-bonus rule of thumb. Pure functions over GeoJSON, so the editor's
 * guidance can be unit-tested without a globe.
 *
 * Distances are approximate on purpose. Natural Earth borders are a shared
 * topology — two neighbouring countries carry the very same vertices along
 * their border — so "shares a vertex" is the land-border test, with a short
 * vertex-to-vertex distance as the fallback for any outline that does not
 * come from that file. Straits are a vertex-distance threshold too; a sea
 * lane the author did not want is one click to remove.
 */

import area from '@turf/area';
import intersect from '@turf/intersect';
import difference from '@turf/difference';
import union from '@turf/union';
import { featureCollection, polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';
// The repo types GeoJSON through the global namespace, not the 'geojson' package.
type Polygon = GeoJSON.Polygon;
type MultiPolygon = GeoJSON.MultiPolygon;
type Position = GeoJSON.Position;
type Feature<G extends GeoJSON.Geometry> = GeoJSON.Feature<G>;

export type PolyGeom = Polygon | MultiPolygon;
export type LngLat = [number, number];
export type Ring = LngLat[];

export interface GeoBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface TerritoryGeom {
  id: string;
  geometry: PolyGeom;
}

export type NeighborKind = 'land' | 'sea';

export interface NeighborMatch {
  id: string;
  type: NeighborKind;
  distanceKm: number;
}

/** Vertices this close count as a shared border even when not identical. */
export const LAND_BORDER_KM = 1.5;
/** Coastlines this close get a sea lane proposed: Øresund, Gibraltar, Messina — not the Channel. */
export const SEA_LANE_KM = 35;

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export function polygonsOf(geom: PolyGeom): Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

export function geometryBbox(geom: PolyGeom): GeoBbox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polygonsOf(geom)) {
    for (const [lng, lat] of poly[0] ?? []) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function ringBbox(ring: Ring): GeoBbox {
  return geometryBbox({ type: 'Polygon', coordinates: [ring] });
}

export function bboxesOverlap(a: GeoBbox, b: GeoBbox, padDeg = 0): boolean {
  return !(
    a.maxLng + padDeg < b.minLng ||
    a.minLng - padDeg > b.maxLng ||
    a.maxLat + padDeg < b.minLat ||
    a.minLat - padDeg > b.maxLat
  );
}

/** Degrees that surely cover `km` at this latitude (longitude degrees shrink towards the poles). */
export function padDegreesForKm(km: number, latDeg: number): number {
  const cos = Math.max(0.15, Math.cos(latDeg * DEG));
  return km / (111 * cos);
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Exterior-ring vertices, largest rings first, evenly thinned so the total
 * stays under `maxTotal`. Enough to find the closest approach of two
 * outlines without comparing every vertex of Canada with every vertex of
 * Russia.
 */
export function exteriorVertices(geom: PolyGeom, maxTotal = 600): LngLat[] {
  const rings = polygonsOf(geom)
    .map((poly) => poly[0] ?? [])
    .filter((r) => r.length > 0)
    .sort((a, b) => b.length - a.length);
  const total = rings.reduce((n, r) => n + r.length, 0);
  if (total <= maxTotal) return rings.flat().map(([lng, lat]) => [lng, lat] as LngLat);
  const out: LngLat[] = [];
  for (const ring of rings) {
    const budget = Math.max(3, Math.floor((ring.length / total) * maxTotal));
    const step = Math.max(1, Math.floor(ring.length / budget));
    for (let i = 0; i < ring.length; i += step) out.push([ring[i][0], ring[i][1]]);
    if (out.length >= maxTotal) break;
  }
  return out;
}

const vertexKey = ([lng, lat]: Position) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

/** True when the two outlines carry an identical vertex: a shared border in a topological dataset. */
export function sharesVertex(a: PolyGeom, b: PolyGeom): boolean {
  const keys = new Set<string>();
  for (const poly of polygonsOf(a)) for (const p of poly[0] ?? []) keys.add(vertexKey(p));
  for (const poly of polygonsOf(b)) for (const p of poly[0] ?? []) if (keys.has(vertexKey(p))) return true;
  return false;
}

export function minVertexDistanceKm(a: PolyGeom, b: PolyGeom, maxVertices = 600): number {
  const va = exteriorVertices(a, maxVertices);
  const vb = exteriorVertices(b, maxVertices);
  let best = Infinity;
  for (const p of va) {
    for (const q of vb) {
      const d = haversineKm(p, q);
      if (d < best) best = d;
    }
  }
  return best;
}

/** How two outlines relate: a land border, a strait a sea lane could cross, or nothing. */
export function classifyNeighbor(
  a: PolyGeom,
  b: PolyGeom,
  options: { seaKm?: number; maxVertices?: number } = {},
): NeighborMatch['type'] extends never ? never : { type: NeighborKind; distanceKm: number } | null {
  const seaKm = options.seaKm ?? SEA_LANE_KM;
  const ba = geometryBbox(a);
  const bb = geometryBbox(b);
  const midLat = ((ba.minLat + ba.maxLat) / 2 + (bb.minLat + bb.maxLat) / 2) / 2;
  if (!bboxesOverlap(ba, bb, padDegreesForKm(seaKm, midLat))) return null;
  if (sharesVertex(a, b)) return { type: 'land', distanceKm: 0 };
  const d = minVertexDistanceKm(a, b, options.maxVertices);
  if (d <= LAND_BORDER_KM) return { type: 'land', distanceKm: d };
  if (d <= seaKm) return { type: 'sea', distanceKm: d };
  return null;
}

/** The territories `subject` borders (and, with `includeSea`, the straits it could cross). */
export function findNeighbors(
  subject: PolyGeom,
  others: TerritoryGeom[],
  options: { includeSea?: boolean; seaKm?: number } = {},
): NeighborMatch[] {
  const includeSea = options.includeSea ?? true;
  const out: NeighborMatch[] = [];
  for (const other of others) {
    const match = classifyNeighbor(subject, other.geometry, { seaKm: options.seaKm });
    if (!match) continue;
    if (match.type === 'sea' && !includeSea) continue;
    out.push({ id: other.id, ...match });
  }
  return out.sort((x, y) => x.distanceKm - y.distanceKm);
}

export interface BridgeEdge {
  from: string;
  to: string;
  type: 'sea';
  distanceKm: number;
}

/**
 * Sea lanes that join every component into one graph, each from the closest
 * pair of coastlines between the connected part and a component still
 * outside it (Prim's walk over components). The result is the minimum the
 * map needs to be reachable; the author can always add more.
 */
export function bridgeComponents(
  components: string[][],
  geometries: Map<string, PolyGeom>,
  maxVertices = 300,
): BridgeEdge[] {
  const pending = components.filter((c) => c.length > 0);
  if (pending.length < 2) return [];
  pending.sort((a, b) => b.length - a.length);
  const joined = new Set(pending[0]);
  let remaining = pending.slice(1);
  const edges: BridgeEdge[] = [];
  const geomOf = (id: string) => geometries.get(id);

  while (remaining.length > 0) {
    let best: { edge: BridgeEdge; componentIndex: number } | null = null;
    remaining.forEach((component, componentIndex) => {
      for (const outsider of component) {
        const go = geomOf(outsider);
        if (!go) continue;
        for (const inside of joined) {
          const gi = geomOf(inside);
          if (!gi) continue;
          const d = minVertexDistanceKm(go, gi, maxVertices);
          if (!best || d < best.edge.distanceKm) {
            best = { edge: { from: inside, to: outsider, type: 'sea', distanceKm: d }, componentIndex };
          }
        }
      }
    });
    if (!best) break; // nothing left with geometry to measure
    const chosen: { edge: BridgeEdge; componentIndex: number } = best;
    edges.push(chosen.edge);
    for (const id of remaining[chosen.componentIndex]) joined.add(id);
    remaining = remaining.filter((_, i) => i !== chosen.componentIndex);
  }
  return edges;
}

// ── Rings ────────────────────────────────────────────────────────────────────

export function closeRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [first[0], first[1]]];
}

/** The same ring without the closing duplicate, which the editor's territories do not carry. */
export function openRing(ring: Ring): Ring {
  if (ring.length < 2) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

export function ringToPolygon(ring: Ring): Feature<Polygon> {
  return turfPolygon([closeRing(ring)]);
}

export function geometryToFeature(geom: PolyGeom): Feature<Polygon | MultiPolygon> {
  return geom.type === 'Polygon' ? turfPolygon(geom.coordinates) : turfMultiPolygon(geom.coordinates);
}

export function ringAreaKm2(ring: Ring): number {
  if (ring.length < 3) return 0;
  return area(ringToPolygon(ring)) / 1e6;
}

export function geometryAreaKm2(geom: PolyGeom): number {
  return area(geometryToFeature(geom)) / 1e6;
}

function segmentsCross(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const orient = (p: LngLat, q: LngLat, r: LngLat) => {
    const v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0;
  };
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** A bow-tie outline: two non-adjacent edges cross. The globe draws it as shards, so Finish refuses it. */
export function ringSelfIntersects(ring: Ring): boolean {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge is adjacent to the first
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

export interface RingOverlap {
  id: string;
  /** Share of the drawn ring's area that lies inside this territory. */
  fraction: number;
}

/** Existing territories a drawn ring lands on, with how much of the ring they cover. */
export function ringOverlaps(ring: Ring, others: TerritoryGeom[], minFraction = 0.02): RingOverlap[] {
  if (ring.length < 3) return [];
  const poly = ringToPolygon(ring);
  const total = area(poly);
  if (!(total > 0)) return [];
  const bb = ringBbox(ring);
  const out: RingOverlap[] = [];
  for (const other of others) {
    if (!bboxesOverlap(bb, geometryBbox(other.geometry))) continue;
    try {
      const shared = intersect(featureCollection([poly, geometryToFeature(other.geometry)]));
      if (!shared) continue;
      const fraction = area(shared) / total;
      if (fraction >= minFraction) out.push({ id: other.id, fraction });
    } catch {
      /* a degenerate outline: treat as no overlap rather than block the author */
    }
  }
  return out.sort((a, b) => b.fraction - a.fraction);
}

/** The largest exterior ring of a geometry, open (no closing duplicate). */
export function largestExteriorRing(geom: PolyGeom): Ring {
  let best: Position[] = [];
  let bestArea = -1;
  for (const poly of polygonsOf(geom)) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    const a = area(turfPolygon([ring]));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return openRing(best.map(([lng, lat]) => [lng, lat] as LngLat));
}

/**
 * The drawn ring with the given territories cut out of it. Holes and
 * detached slivers are dropped — a territory is one outline — so the result
 * is the largest piece left. Null when nothing is left.
 */
export function trimRing(ring: Ring, overlappers: PolyGeom[]): Ring | null {
  if (overlappers.length === 0) return openRing(ring);
  try {
    const features = overlappers.map(geometryToFeature);
    const cutter = features.length === 1 ? features[0] : union(featureCollection(features));
    if (!cutter) return openRing(ring);
    const left = difference(featureCollection([ringToPolygon(ring), cutter]));
    if (!left) return null;
    const result = largestExteriorRing(left.geometry);
    return result.length >= 3 ? result : null;
  } catch {
    return null;
  }
}

/** Centroid of the largest ring (planar, in degrees — a label anchor, not a survey). */
export function geometryLabelPoint(geom: PolyGeom): LngLat {
  const ring = largestExteriorRing(geom);
  if (ring.length === 0) return [0, 0];
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

// ── Regions ──────────────────────────────────────────────────────────────────

export interface RegionStat {
  size: number;
  /** Territories with a connection to another region: the ones that have to be defended. */
  borders: number;
}

export function regionStats(
  territories: Array<{ territory_id: string; region_id: string }>,
  connections: Array<{ from: string; to: string }>,
): Map<string, RegionStat> {
  const regionOf = new Map(territories.map((t) => [t.territory_id, t.region_id] as const));
  const borderIds = new Set<string>();
  for (const c of connections) {
    const a = regionOf.get(c.from);
    const b = regionOf.get(c.to);
    if (a === undefined || b === undefined || a === b) continue;
    borderIds.add(c.from);
    borderIds.add(c.to);
  }
  const stats = new Map<string, RegionStat>();
  for (const t of territories) {
    const s = stats.get(t.region_id) ?? { size: 0, borders: 0 };
    s.size += 1;
    if (borderIds.has(t.territory_id)) s.borders += 1;
    stats.set(t.region_id, s);
  }
  return stats;
}

/** The region-bonus rule of thumb lives with the structural analysis in @borderfall/shared. */
export { suggestRegionBonus } from '@borderfall/shared';

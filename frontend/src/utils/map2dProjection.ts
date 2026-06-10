import type { PolygonData } from './globeTerritoryGeometry';

/**
 * Projects real territory geometries (lon/lat GeoJSON, the same data the 3D
 * globe renders) into a map's 2D canvas coordinate space, so the existing
 * canvas→screen scaling pipeline keeps working unchanged.
 *
 * Equirectangular with aspect-preserving fit: the union bounding box of all
 * geometries (or the map's own projection_bounds) is fitted into
 * canvasW×canvasH, centered, with y flipped (north up).
 */

export interface GeoLayout2d {
  /** territory_id → rings in canvas coordinates (outer rings only; holes dropped). */
  rings: Map<string, [number, number][][]>;
  /** territory_id → label/badge anchor in canvas coordinates (largest-ring centroid). */
  centers: Map<string, [number, number]>;
}

export interface ProjectionBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

function geometryOuterRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number][][] {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys
    .map((poly) => (poly[0] ?? []).map(([lng, lat]) => [lng, lat] as [number, number]))
    .filter((ring) => ring.length >= 3);
}

export function unionBounds(polygons: PolygonData[]): ProjectionBounds | null {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of polygons) {
    for (const ring of geometryOuterRings(p.geometry)) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!Number.isFinite(minLng) || maxLng <= minLng || maxLat <= minLat) return null;
  return { minLng, maxLng, minLat, maxLat };
}

export function projectPoint(
  lng: number,
  lat: number,
  bounds: ProjectionBounds,
  canvasW: number,
  canvasH: number,
): [number, number] {
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  // Aspect-preserving fit with centering, north up.
  const scale = Math.min(canvasW / lngSpan, canvasH / latSpan);
  const offsetX = (canvasW - lngSpan * scale) / 2;
  const offsetY = (canvasH - latSpan * scale) / 2;
  return [
    (lng - bounds.minLng) * scale + offsetX,
    (bounds.maxLat - lat) * scale + offsetY,
  ];
}

/** Largest ring's vertex centroid — good enough for a badge/label anchor. */
function largestRingCentroid(rings: [number, number][][]): [number, number] | null {
  let best: [number, number][] | null = null;
  let bestArea = -Infinity;
  for (const ring of rings) {
    // Shoelace area as size proxy (absolute value; orientation irrelevant).
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      area += x1 * y2 - x2 * y1;
    }
    area = Math.abs(area) / 2;
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  if (!best) return null;
  const cx = best.reduce((s, [x]) => s + x, 0) / best.length;
  const cy = best.reduce((s, [, y]) => s + y, 0) / best.length;
  return [cx, cy];
}

/**
 * Build the 2D layout, or null when coverage is incomplete. All-or-nothing on
 * purpose: hand-placed rectangle coordinates and geo-projected shapes live in
 * unrelated coordinate systems, so mixing them would scatter the map.
 */
export function buildGeoLayout2d(
  polygons: PolygonData[],
  territoryIds: string[],
  canvasW: number,
  canvasH: number,
  mapBounds?: ProjectionBounds | null,
): GeoLayout2d | null {
  if (territoryIds.length === 0) return null;
  const byId = new Map(polygons.map((p) => [p.territory_id, p]));
  for (const tid of territoryIds) {
    if (!byId.has(tid)) return null;
  }

  const relevant = territoryIds.map((tid) => byId.get(tid)!);
  const bounds = mapBounds ?? unionBounds(relevant);
  if (!bounds) return null;

  const rings = new Map<string, [number, number][][]>();
  const centers = new Map<string, [number, number]>();
  for (const p of relevant) {
    const projected = geometryOuterRings(p.geometry).map((ring) =>
      ring.map(([lng, lat]) => projectPoint(lng, lat, bounds, canvasW, canvasH)),
    );
    if (projected.length === 0) return null;
    const centroid = largestRingCentroid(projected);
    if (!centroid) return null;
    rings.set(p.territory_id, projected);
    centers.set(p.territory_id, centroid);
  }
  return { rings, centers };
}

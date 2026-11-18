/**
 * How a map's shapes land in a preview box.
 *
 * Built-in boards carry canvas polygons sized to their canvas, which scale
 * straight into the box. Editor-made maps carry real geography instead:
 * their rings are longitude/latitude (a drawn `geo_polygon`, or a country's
 * outline), and the canvas size is the default nobody set. Those get an
 * equirectangular fit of their own bounding box, with longitude shortened by
 * the cosine of the middle latitude so Europe is not twice as wide as it is.
 */

export interface PreviewTerritoryLike {
  polygon: [number, number][];
  center_point: [number, number];
  geo_polygon?: [number, number][];
  iso_codes?: string[];
  admin1?: string[];
  geo_config?: unknown;
  /** The cell a Voronoi board clips the territory's countries to. */
  clip_polygon?: number[][][];
}

export interface PreviewMapLike {
  canvas_width: number;
  canvas_height: number;
  projection_bounds?: unknown;
  territories: PreviewTerritoryLike[];
}

export type Projector = (point: [number, number]) => [number, number];

/** Editor-made maps: real geography and no authored canvas projection. */
export function previewUsesGeography(map: PreviewMapLike): boolean {
  if (map.projection_bounds) return false;
  return map.territories.some((t) =>
    (t.geo_polygon && t.geo_polygon.length >= 3)
    || (t.iso_codes && t.iso_codes.length > 0)
    || (t.admin1 && t.admin1.length > 0)
    || !!t.geo_config,
  );
}

interface ProjectionBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

function isProjectionBounds(b: unknown): b is ProjectionBounds {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return ['minLng', 'maxLng', 'minLat', 'maxLat'].every((k) => typeof o[k] === 'number')
    && o.maxLng !== o.minLng && o.maxLat !== o.minLat;
}

/**
 * The land of a Voronoi board's territory, on its canvas.
 *
 * Sengoku Japan, the Roman Empire 117, the Mongol Empire and Napoleonic Europe
 * clip each territory's countries to a cell of the board (`clip_polygon`). The
 * canvas `polygon` is that cell, sea and all, so a preview drawing it showed a
 * patchwork of rectangles rather than Japan. `geo_polygon` holds the land the
 * globe draws (database/maps/bake_land_outlines.py), placed here through the
 * board's projection_bounds exactly as the canvas polygons were.
 */
function clipCellLand(t: PreviewTerritoryLike, map: PreviewMapLike): [number, number][] | null {
  if (!t.clip_polygon?.length || !t.geo_polygon || t.geo_polygon.length < 3) return null;
  const b = map.projection_bounds;
  if (!isProjectionBounds(b)) return null;
  const sx = map.canvas_width / (b.maxLng - b.minLng);
  const sy = map.canvas_height / (b.maxLat - b.minLat);
  return t.geo_polygon.map(([lng, lat]) => [(lng - b.minLng) * sx, (b.maxLat - lat) * sy]);
}

/** The ring a preview draws for a territory. */
export function previewRing(t: PreviewTerritoryLike, geography: boolean, map?: PreviewMapLike): [number, number][] {
  if (geography) return t.geo_polygon && t.geo_polygon.length >= 3 ? t.geo_polygon : t.polygon;
  return (map && clipCellLand(t, map)) ?? t.polygon;
}

/** Area-weighted centroid of a ring; its first point when the ring has no area. */
function ringCentroid(ring: [number, number][]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Where a preview puts a territory's dot and the ends of its connection lines.
 * A Voronoi board's `center_point` is its cell's, often out at sea; its land's
 * centroid is not.
 */
export function previewCenter(t: PreviewTerritoryLike, map?: PreviewMapLike): [number, number] {
  const land = map ? clipCellLand(t, map) : null;
  return land ? ringCentroid(land) : t.center_point;
}

export function canvasProjector(map: PreviewMapLike, width: number, height: number): Projector {
  const scale = Math.min(width / map.canvas_width, height / map.canvas_height);
  const offsetX = (width - map.canvas_width * scale) / 2;
  const offsetY = (height - map.canvas_height * scale) / 2;
  return ([x, y]) => [x * scale + offsetX, y * scale + offsetY];
}

export function geographyProjector(map: PreviewMapLike, width: number, height: number, padFraction = 0.06): Projector {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const t of map.territories) {
    for (const [lng, lat] of previewRing(t, true)) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng)) return () => [width / 2, height / 2];
  const midLat = (minLat + maxLat) / 2;
  const k = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanX = Math.max(1e-6, (maxLng - minLng) * k);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const pad = Math.min(width, height) * padFraction;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return ([lng, lat]) => [(lng - minLng) * k * scale + offsetX, (maxLat - lat) * scale + offsetY];
}

export function previewProjector(map: PreviewMapLike, width: number, height: number): { project: Projector; geography: boolean } {
  const geography = previewUsesGeography(map);
  return { project: geography ? geographyProjector(map, width, height) : canvasProjector(map, width, height), geography };
}

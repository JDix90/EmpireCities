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

/** The ring a preview draws for a territory. */
export function previewRing(t: PreviewTerritoryLike, geography: boolean): [number, number][] {
  return geography && t.geo_polygon && t.geo_polygon.length >= 3 ? t.geo_polygon : t.polygon;
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

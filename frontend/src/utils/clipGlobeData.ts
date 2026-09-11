/**
 * Turns the globe geometry the app already builds (`buildTerritoryGlobeGeometries`,
 * the same call GlobeMap and the 2D map make) into the compact per-frame form
 * the clip renderer projects.
 *
 * Two jobs beyond reshaping:
 *
 *  - **Framing.** Pick where the camera looks and how much of the sphere it
 *    must cover, honoring a map's authored `globe_view` center when it has one
 *    so a shared clip frames the theater the same way the live globe does.
 *  - **Decimation.** Natural Earth rings carry tens of thousands of vertices.
 *    A clip frame is at most ~700px of board and every vertex costs four trig
 *    calls per frame, so rings are strided down to a budget that is still far
 *    denser than the output can show.
 */
import type { PolygonData } from './globeTerritoryGeometry';
import { angularExtentOf } from './clipGlobeProjection';
import type { ClipGlobeData, ClipGlobeTerritory } from './replayClipRenderer';

/** Vertices kept per ring. ~1 vertex per 2px of coastline at video resolution. */
const MAX_RING_POINTS = 400;
/** Rings kept per territory, largest first — bounds archipelago-heavy maps. */
const MAX_RINGS_PER_TERRITORY = 12;
/**
 * Samples per ring fed to the framing pass — a share of each ring, not a fixed
 * stride. A fixed stride reads only the first vertex of any ring shorter than
 * it, so small islands and authored boxes contributed a single corner and
 * dragged the camera off the theater they were supposed to help frame.
 */
const EXTENT_SAMPLES_PER_RING = 24;

/**
 * Zoom limits, in angular radius covered by the frame.
 *
 * 90° is the whole visible hemisphere — a world map, horizon to horizon. The
 * floor only guards against a hypothetical single-city map zooming past any
 * useful scale; it is deliberately well below the smallest real theater.
 * Measured against the shipped maps at 9:16, a theater reads best at its own
 * natural extent: Risorgimento (Italy) frames at ~7° and the American Civil
 * War at ~25°, and clamping either up to a "keep the curvature visible" floor
 * of 16° shrank Italy to a speck in an empty ocean.
 */
const MIN_ANGULAR_RADIUS_DEG = 6;
const MAX_ANGULAR_RADIUS_DEG = 90;
/** Breathing room so coastlines do not touch the edge of the board box. */
const FRAMING_MARGIN = 1.12;

export interface ClipGlobeViewConfig {
  center_lat?: number;
  center_lng?: number;
}

function outerRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number][][] {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings: [number, number][][] = [];
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    rings.push(ring.map(([lng, lat]) => [lng, lat] as [number, number]));
  }
  return rings;
}

/** lon/lat bbox area — a size proxy for ranking rings, not a real area. */
function ringSpan(ring: [number, number][]): number {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return (maxLng - minLng) * (maxLat - minLat);
}

/** Keep every Nth vertex, and always the first — a closed ring needs no last. */
function decimate(ring: [number, number][], budget: number): [number, number][] {
  if (ring.length <= budget) return ring;
  const stride = Math.ceil(ring.length / budget);
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += stride) out.push(ring[i]);
  return out.length >= 3 ? out : ring;
}

export interface BuildClipGlobeOptions {
  /** Territories to draw — sea lanes and off-world tiles are the caller's to exclude. */
  territoryIds: string[];
  /** The map's authored camera, when it has one. */
  globeView?: ClipGlobeViewConfig | null;
}

/**
 * Build the clip's globe payload, or null when the map has no usable geometry
 * (galaxy boards, or geo sources that failed to load) — the renderer then falls
 * back to the flat authored polygons.
 */
export function buildClipGlobeData(
  polygons: PolygonData[],
  { territoryIds, globeView }: BuildClipGlobeOptions,
): ClipGlobeData | null {
  if (polygons.length === 0 || territoryIds.length === 0) return null;
  const wanted = new Set(territoryIds);
  const byId = new Map(polygons.map((p) => [p.territory_id, p]));

  const territories: ClipGlobeTerritory[] = [];
  const samples: [number, number][] = [];
  for (const territoryId of territoryIds) {
    const poly = byId.get(territoryId);
    if (!poly) continue;
    const rings = outerRings(poly.geometry)
      .sort((a, b) => ringSpan(b) - ringSpan(a))
      .slice(0, MAX_RINGS_PER_TERRITORY)
      .map((ring) => decimate(ring, MAX_RING_POINTS));
    if (rings.length === 0) continue;
    territories.push({ territory_id: territoryId, rings });
    for (const ring of rings) {
      const stride = Math.max(1, Math.ceil(ring.length / EXTENT_SAMPLES_PER_RING));
      for (let i = 0; i < ring.length; i += stride) samples.push(ring[i]);
      // The stride can skip the last vertex, and on a ring that is mostly one
      // long limb it is exactly the extreme the framing needs.
      samples.push(ring[ring.length - 1]);
    }
  }
  // All-or-nothing on coverage would be too strict here (one unmapped tile
  // should not flatten the whole clip), but a board that resolved almost
  // nothing is not a globe worth showing.
  if (territories.length === 0 || territories.length * 2 < wanted.size) return null;

  const authoredCenter =
    globeView && typeof globeView.center_lat === 'number' && typeof globeView.center_lng === 'number'
      ? { lng: globeView.center_lng, lat: globeView.center_lat }
      : undefined;
  const extent = angularExtentOf(samples, authoredCenter);
  if (!extent) return null;

  return {
    territories,
    camera: {
      centerLng: extent.centerLng,
      centerLat: extent.centerLat,
      angularRadiusDeg: Math.min(
        MAX_ANGULAR_RADIUS_DEG,
        Math.max(MIN_ANGULAR_RADIUS_DEG, extent.radiusDeg * FRAMING_MARGIN),
      ),
    },
  };
}

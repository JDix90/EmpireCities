import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMaritimeFrontierRing,
  MARITIME_FRONTIER_PROFILES,
  MARITIME_PROFILES,
  type MaritimeProfileName,
} from './maritimeFrontierRing';
import { signedLngLatRingArea } from './galaxyOrganicGlobeRing';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadJson = (p: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf-8'));

const PROFILE_NAMES = Object.keys(MARITIME_PROFILES) as MaritimeProfileName[];

/** A square, a wide shallow band, and a tall narrow one. */
const rect = (
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): [number, number][] => [
  [minLng, maxLat],
  [maxLng, maxLat],
  [maxLng, minLat],
  [minLng, minLat],
];

function openRing(ring: [number, number][]): [number, number][] {
  const last = ring.length - 1;
  return ring.length > 1 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
    ? ring.slice(0, -1)
    : ring;
}

function ringArea(ring: [number, number][]): number {
  return Math.abs(signedLngLatRingArea(openRing(ring)));
}

function segmentsCross(
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
): boolean {
  const cross = (p: number[], q: number[], r: number[]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b);
  const d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * True when no two non-adjacent edges cross. An outline that crosses itself
 * renders as a pinched notch and triangulates into shards on the globe.
 */
function isSimple(ring: [number, number][]): boolean {
  const pts = openRing(ring);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

describe('buildMaritimeFrontierRing', () => {
  it.each(PROFILE_NAMES)('%s stays inside the authored rectangle', (profile) => {
    // The rectangle is the tile's footprint on the board — how far it may reach
    // toward its neighbours. The shape inside it is ours; the extent is not.
    for (const box of [rect(-30, -40, -10, -26), rect(-20, 84, 70, 89), rect(160, -12, 178, 4)]) {
      const ring = buildMaritimeFrontierRing(box, 'probe', profile);
      for (const [lng, lat] of ring) {
        expect(lng).toBeGreaterThanOrEqual(Math.min(...box.map((c) => c[0])) - 1e-9);
        expect(lng).toBeLessThanOrEqual(Math.max(...box.map((c) => c[0])) + 1e-9);
        expect(lat).toBeGreaterThanOrEqual(Math.min(...box.map((c) => c[1])) - 1e-9);
        expect(lat).toBeLessThanOrEqual(Math.max(...box.map((c) => c[1])) + 1e-9);
      }
    }
  });

  it.each(PROFILE_NAMES)('%s produces an outline that does not cross itself', (profile) => {
    // Regression: wobble used to push points outward and get clamped back onto
    // the bounding box, folding the ring and leaving a visible zigzag notch at
    // the end of each Arctic band. Displacement is inward-only now.
    for (const box of [rect(-30, -40, -10, -26), rect(-20, 84, 70, 89)]) {
      expect(isSimple(buildMaritimeFrontierRing(box, 'probe', profile)), profile).toBe(true);
    }
  });

  it('keeps a wide, shallow band a band rather than a sliver', () => {
    // Regression: an inscribed *ellipse* in the 90-by-5-degree Arctic band
    // tapered to nothing at both ends and threw away most of the tile. The
    // superellipse base curve is what keeps the area.
    const box = rect(-20, 84, 70, 89);
    const ring = buildMaritimeFrontierRing(box, 'arctic_reclamation', 'shelf');
    const boxArea = (70 - -20) * (89 - 84);
    expect(ringArea(ring) / boxArea).toBeGreaterThan(0.55);
  });

  it.each(PROFILE_NAMES)('%s is deterministic for a given territory', (profile) => {
    const box = rect(-30, -40, -10, -26);
    expect(buildMaritimeFrontierRing(box, 'same_id', profile)).toEqual(
      buildMaritimeFrontierRing(box, 'same_id', profile),
    );
  });

  it('gives two tiles sharing a profile different outlines', () => {
    // Both Arctic tiles are shelves; they should not be the same stamp twice.
    const box = rect(-20, 84, 70, 89);
    expect(buildMaritimeFrontierRing(box, 'arctic_reclamation', 'shelf')).not.toEqual(
      buildMaritimeFrontierRing(box, 'arctic_siberian_shelf', 'shelf'),
    );
  });

  it('returns a closed ring wound the way the galaxy caps are', () => {
    const ring = buildMaritimeFrontierRing(rect(-30, -40, -10, -26), 'probe', 'field');
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(signedLngLatRingArea(openRing(ring))).toBeGreaterThan(0);
  });

  it('leaves a shape that is not a four-corner rectangle alone', () => {
    // A hand-drawn sea outline is already what this function exists to produce.
    const drawn: [number, number][] = [[0, 0], [2, 1], [3, 4], [1, 5], [-1, 2]];
    expect(buildMaritimeFrontierRing(drawn, 'x', 'field')).toEqual(drawn);
  });
});

describe('era_space_age sea frontiers', () => {
  const map = loadJson('../../../database/maps/era_space_age.json') as {
    territories: { territory_id: string; geo_polygon?: [number, number][] }[];
  };

  it('routes every authored rectangle in the sea through a profile', () => {
    // Guards the reverse direction too: a profile naming a territory that no
    // longer authors a rectangle is dead configuration.
    for (const id of Object.keys(MARITIME_FRONTIER_PROFILES)) {
      const t = map.territories.find((x) => x.territory_id === id);
      expect(t, `${id} is not on the Space Age map`).toBeTruthy();
      expect(openRing(t!.geo_polygon!), `${id} no longer authors a rectangle`).toHaveLength(4);
    }
  });

  it('renders them as sea outlines instead of the authored rectangles', () => {
    const polys = buildTerritoryGlobeGeometries(
      map as Parameters<typeof buildTerritoryGlobeGeometries>[0],
      { countriesGeo: null, statesGeo: null, risorgimentoGeo: null },
    );
    const byId = new Map(polys.map((p) => [p.territory_id, p]));
    for (const id of Object.keys(MARITIME_FRONTIER_PROFILES)) {
      const geom = byId.get(id)!.geometry;
      expect(geom.type, id).toBe('Polygon');
      const ring = (geom as GeoJSON.Polygon).coordinates[0] as [number, number][];
      // Four corners plus the repeated first point is the authored rectangle.
      expect(openRing(ring).length, `${id} still renders as its authored rectangle`)
        .toBeGreaterThan(16);
      expect(isSimple(ring), `${id} outline crosses itself`).toBe(true);
    }
  });
});

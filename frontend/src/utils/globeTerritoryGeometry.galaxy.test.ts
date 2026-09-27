import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedLngLatRingArea } from './galaxyOrganicGlobeRing';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const galaxyMap = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../database/maps/era_galaxy.json'),
    'utf-8',
  ),
);

/**
 * Regression test for the "speckled planet" bug.
 *
 * `three-conic-polygon-geometry` (used by `react-globe.gl`) feeds the
 * geometry through d3-geo / @turf for `geoBounds` and point-in-polygon checks.
 * d3-geo's spherical right-hand rule treats math-CCW exterior rings as the
 * polygon's complement — i.e. "everything on the sphere EXCEPT the rectangle".
 *
 * When that happens for `era_galaxy`'s wide rectangular caps, the inner
 * spiral grid lattice generates ~1,650 points scattered across the entire
 * planet surface and the cap material (player color) renders as thousands of
 * tiny triangles speckled across the texture instead of one clean rectangle.
 *
 * These tests assert each galaxy territory's exterior ring is **math-clockwise**
 * (signed planar shoelace / 2 > 0 on an open ring in lng/lat with y-up).
 */
function openRing(ring: GeoJSON.Position[]): [number, number][] {
  const r = ring as [number, number][];
  if (
    r.length > 1 &&
    r[0][0] === r[r.length - 1][0] &&
    r[0][1] === r[r.length - 1][1]
  ) {
    return r.slice(0, -1);
  }
  return r;
}

describe('era_galaxy globe geometry', () => {
  const polys = buildTerritoryGlobeGeometries(
    galaxyMap as Parameters<typeof buildTerritoryGlobeGeometries>[0],
    { countriesGeo: null, statesGeo: null, risorgimentoGeo: null },
  );

  it('produces exactly one polygon per authored territory', () => {
    expect(polys.length).toBe(
      (galaxyMap as { territories: unknown[] }).territories.length,
    );
  });

  it('every cap exterior ring is math-CW (matches d3-geo spherical right-hand rule)', () => {
    for (const p of polys) {
      if (p.territory_id.startsWith('sol_')) continue;
      const ring =
        p.geometry.type === 'Polygon'
          ? p.geometry.coordinates[0]
          : p.geometry.coordinates[0][0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(signedLngLatRingArea(openRing(ring))).toBeGreaterThan(0);
    }
  });

  it('every cap stays inside the authored projection_bounds (no whole-sphere spill)', () => {
    const proj = (
      galaxyMap as {
        projection_bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
      }
    ).projection_bounds;
    for (const p of polys) {
      if (p.territory_id.startsWith('sol_')) continue;
      const ring =
        p.geometry.type === 'Polygon'
          ? p.geometry.coordinates[0]
          : p.geometry.coordinates[0][0];
      const lngs = ring.map((c) => c[0]);
      const lats = ring.map((c) => c[1]);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      expect(minLng).toBeGreaterThanOrEqual(proj.minLng - 1);
      expect(maxLng).toBeLessThanOrEqual(proj.maxLng + 1);
      expect(minLat).toBeGreaterThanOrEqual(proj.minLat - 1);
      expect(maxLat).toBeLessThanOrEqual(proj.maxLat + 1);
      // Exo Voronoi UV cells can be wide (e.g. Nexus hull ~220° lng); still not a whole-sphere complement.
      expect(maxLng - minLng).toBeLessThan(340);
      expect(maxLat - minLat).toBeLessThan(170);
    }
  });
});

describe('era_ascension_galaxy far-world globe geometry', () => {
  // Space to Stars draws the far worlds from `geo_polygon`, not the era_galaxy
  // ring module, so the same winding rule has to hold on that path too.
  const ascensionMap = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../database/maps/era_ascension_galaxy.json'),
      'utf-8',
    ),
  ) as { territories: Array<{ territory_id: string; world_id?: string; geo_polygon?: [number, number][] }> };
  const farIds = new Set(
    ascensionMap.territories
      .filter((t) => t.world_id === 'verdan' || t.world_id === 'rust' || t.world_id === 'nexus_station')
      .map((t) => t.territory_id),
  );
  const polys = buildTerritoryGlobeGeometries(
    ascensionMap as unknown as Parameters<typeof buildTerritoryGlobeGeometries>[0],
    { countriesGeo: null, statesGeo: null, risorgimentoGeo: null },
  ).filter((p) => farIds.has(p.territory_id));

  it('draws every far-world tile from its authored ring, math-CW', () => {
    expect(polys).toHaveLength(48);
    const byId = new Map(ascensionMap.territories.map((t) => [t.territory_id, t]));
    for (const p of polys) {
      const ring = p.geometry.type === 'Polygon' ? p.geometry.coordinates[0] : p.geometry.coordinates[0][0];
      expect(signedLngLatRingArea(openRing(ring)), p.territory_id).toBeGreaterThan(0);
      const authored = byId.get(p.territory_id)!.geo_polygon!;
      expect(openRing(ring).length, p.territory_id).toBe(openRing(authored).length);
    }
  });
});

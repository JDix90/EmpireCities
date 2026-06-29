import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedLngLatRingArea } from './galaxyOrganicGlobeRing';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regression test for the "triangular shard fills" bug on inline `geo_polygon`
 * regional maps (Charlemagne 814 + the 10 r/imaginarymaps theaters).
 *
 * three-conic-polygon-geometry (react-globe.gl) feeds caps through d3-geo, whose
 * spherical right-hand rule treats a math-CCW exterior ring as the polygon's
 * COMPLEMENT — the cap then triangulates into spiky shards / a giant blob instead
 * of filling the territory. Authored inline rings must therefore rewind to the
 * orientation d3-geo reads as "interior" (signedLngLatRingArea > 0), which the
 * inline path achieves by including these maps in INLINE_GEO_POLYGON_REVERSE_MAP_IDS
 * (reverse: true), exactly like the galaxy caps and flooded North America.
 *
 * Mirrors globeTerritoryGeometry.galaxy.test.ts.
 */
const INLINE_MAP_IDS = [
  'community_charlemagne_814',
  'community_balkanized_usa',
  'community_fractured_china',
  'community_balkanized_india',
  'community_uncolonized_africa',
  'community_south_america',
  'community_divided_japan',
  'community_fractured_russia',
  'community_byzantium_megali',
  'community_balkanized_spain',
  'community_nusantara',
];

function loadMap(mapId: string) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../../../database/maps/${mapId}.json`),
      'utf-8',
    ),
  );
}

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

describe('regional inline geo_polygon globe geometry', () => {
  for (const mapId of INLINE_MAP_IDS) {
    describe(mapId, () => {
      const map = loadMap(mapId);
      const polys = buildTerritoryGlobeGeometries(
        map as Parameters<typeof buildTerritoryGlobeGeometries>[0],
        { countriesGeo: null, statesGeo: null, risorgimentoGeo: null },
      );

      it('produces one polygon per authored territory', () => {
        expect(polys.length).toBe(
          (map as { territories: unknown[] }).territories.length,
        );
      });

      it('every cap exterior ring is the interior orientation d3-geo fills (signed area > 0)', () => {
        for (const p of polys) {
          const ring =
            p.geometry.type === 'Polygon'
              ? p.geometry.coordinates[0]
              : p.geometry.coordinates[0][0];
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(signedLngLatRingArea(openRing(ring))).toBeGreaterThan(0);
        }
      });
    });
  }
});

/**
 * Era world maps grow as players advance: later-era frontier territories ship an
 * inline `geo_polygon` (real WGS84 ring) so the globe renders them at their true
 * location instead of the world-equirectangular canvas fallback (which threw
 * frontiers like `volga_bulgaria` into the Arctic as a malformed shard). These
 * maps are in INLINE_GEO_POLYGON_REVERSE_MAP_IDS, so each frontier cap must come
 * out in the interior orientation d3-geo fills (signed area > 0), like the
 * community maps above.
 */
const ERA_GROWTH_MAP_IDS = [
  'era_ancient',
  'era_medieval',
  'era_discovery',
  'era_ww2',
  'era_coldwar',
  'era_modern',
  'era_space_age',
];

describe('era growth-frontier inline geo_polygon globe geometry', () => {
  for (const mapId of ERA_GROWTH_MAP_IDS) {
    describe(mapId, () => {
      const map = loadMap(mapId) as {
        territories: { territory_id: string; geo_polygon?: number[][] }[];
      };
      // Build with no country data so frontiers resolve through the geo_polygon path.
      const polys = buildTerritoryGlobeGeometries(
        map as Parameters<typeof buildTerritoryGlobeGeometries>[0],
        { countriesGeo: null, statesGeo: null, risorgimentoGeo: null },
      );
      const byId = new Map(polys.map((p) => [p.territory_id, p]));
      const frontiers = map.territories.filter((t) => Array.isArray(t.geo_polygon));

      it('has growth frontiers carrying geo_polygon', () => {
        expect(frontiers.length).toBeGreaterThan(0);
      });

      it('every frontier cap renders in the interior orientation (signed area > 0)', () => {
        for (const t of frontiers) {
          const p = byId.get(t.territory_id);
          expect(p, t.territory_id).toBeTruthy();
          const ring =
            p!.geometry.type === 'Polygon'
              ? p!.geometry.coordinates[0]
              : p!.geometry.coordinates[0][0];
          expect(ring.length, t.territory_id).toBeGreaterThanOrEqual(4);
          expect(
            signedLngLatRingArea(openRing(ring)),
            t.territory_id,
          ).toBeGreaterThan(0);
        }
      });
    });
  }
});

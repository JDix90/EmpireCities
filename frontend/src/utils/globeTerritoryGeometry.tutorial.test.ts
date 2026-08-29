import { describe, it, expect } from 'vitest';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

/**
 * Regression guard for Tutorial Island's globe rendering.
 *
 * `buildTerritoryGlobeGeometries` keeps an allow-list of map ids whose inline
 * rings are rewound the opposite way from `@turf/rewind`'s default. Verified by
 * rendering: a map ON the list comes out with a clockwise exterior ring, which
 * is what three-globe's ConicPolygonGeometry triangulates correctly; a map off
 * it comes out counter-clockwise and the caps collapse into a few stray shards,
 * leaving only the polygon side walls drawn.
 *
 * Tutorial Island shipped off that list, so the first map a new player ever
 * sees rendered as bare gold outlines over open ocean. Nothing else catches
 * this: the 2D view reads canvas coordinates directly and looked perfect the
 * whole time, and no unit test rendered a globe.
 */
const EMPTY_INPUTS = {
  countriesGeo: null,
  statesGeo: null,
  risorgimentoGeo: null,
  admin50Geo: null,
  straitHormuzGeo: null,
  australiaGeo: null,
  britainGeo: null,
  hornAfricaGeo: null,
  mexicoGeo: null,
  regionalAdmin1Geo: null,
};

/** Shoelace on [lng, lat]: negative = clockwise exterior ring. */
function signedArea(ring: GeoJSON.Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function tutorialLikeMap(mapId: string) {
  return {
    map_id: mapId,
    canvas_width: 20,
    canvas_height: 20,
    projection_bounds: { minLng: -34.4, maxLng: -20.4, minLat: 32.0, maxLat: 43.0 },
    territories: [
      {
        territory_id: 'tut_a3',
        name: 'Northern Hills',
        region_id: 'tut_west',
        polygon: [[0, 5], [10, 5], [10, 0], [0, 0]],
        center_point: [5, 2.5] as [number, number],
        geo_polygon: [
          [-34.4, 40.25], [-27.4, 40.25], [-27.4, 43.0], [-34.4, 43.0],
        ] as [number, number][],
      },
    ],
  };
}

describe('Tutorial Island globe geometry', () => {
  it('winds its caps clockwise, so three-globe can triangulate them', () => {
    const [poly] = buildTerritoryGlobeGeometries(tutorialLikeMap('tutorial'), EMPTY_INPUTS);
    expect(poly).toBeDefined();
    const geom = poly.geometry;
    const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    expect(signedArea(ring)).toBeLessThan(0);
  });

  it('is the allow-list doing that, not the default path', () => {
    // Same rings under an unregistered map id come out the other way round —
    // this is what "forgot to add the map id" actually looks like.
    const [poly] = buildTerritoryGlobeGeometries(tutorialLikeMap('not_registered'), EMPTY_INPUTS);
    const geom = poly.geometry;
    const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    expect(signedArea(ring)).toBeGreaterThan(0);
  });
});

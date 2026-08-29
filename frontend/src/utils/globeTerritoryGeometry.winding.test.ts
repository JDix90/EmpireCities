import { describe, it, expect } from 'vitest';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

/**
 * Regression guard for inline-ring winding on the globe.
 *
 * `buildTerritoryGlobeGeometries` must rewind authored rings to a clockwise
 * exterior — verified by rendering: clockwise triangulates into real caps,
 * counter-clockwise collapses into a few stray shards and leaves only the
 * polygon side walls drawn.
 *
 * This was an allow-list of map ids, and Tutorial Island shipped off it, so the
 * first map a new player ever sees rendered as bare gold outlines over open
 * ocean. Nothing else catches this class of bug: the 2D view reads canvas
 * coordinates directly and looks perfect regardless, and no unit test renders
 * a globe. The winding is now unconditional, so these tests also stand in for
 * every user-created map, which could never have been in a hardcoded list.
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

  it('winds a map id nobody has ever seen the same way', () => {
    // The case the allow-list could never cover: MapEditorPage saves
    // `geo_polygon` for every user-drawn territory, and a community map's id is
    // generated per map. If this ever diverges from the tutorial case above,
    // every user-created map renders as shards.
    const [poly] = buildTerritoryGlobeGeometries(tutorialLikeMap('user_map_a1b2c3'), EMPTY_INPUTS);
    const geom = poly.geometry;
    const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    expect(signedArea(ring)).toBeLessThan(0);
  });

  it('does not care which way the author drew the ring', () => {
    // @turf/rewind normalizes either input order to the same output, which is
    // why a per-map winding flag never encoded anything real.
    const clockwise = tutorialLikeMap('user_map_a1b2c3');
    const counter = tutorialLikeMap('user_map_a1b2c3');
    counter.territories[0].geo_polygon = [...counter.territories[0].geo_polygon].reverse();
    const ringOf = (m: ReturnType<typeof tutorialLikeMap>) => {
      const geom = buildTerritoryGlobeGeometries(m, EMPTY_INPUTS)[0].geometry;
      return geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    };
    expect(signedArea(ringOf(clockwise))).toBeLessThan(0);
    expect(signedArea(ringOf(counter))).toBeLessThan(0);
  });
});

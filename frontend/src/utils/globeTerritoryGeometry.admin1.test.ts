import { describe, it, expect } from 'vitest';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

/**
 * Unit test for the generic admin-1 geometry path: a territory's `admin1`
 * (ISO 3166-2 codes) resolves to real Natural Earth admin-1 polygons from
 * `admin50Geo`, unions multiple units, and falls back to `geo_polygon` when a
 * code does not resolve. Uses synthetic admin features so it runs without the
 * Natural Earth CDN download.
 */
function adminFeature(code: string, ring: number[][]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { iso_3166_2: code },
    geometry: { type: 'Polygon', coordinates: [ring] },
  } as GeoJSON.Feature;
}

const CA_RING = [[-124, 42], [-114, 42], [-114, 33], [-124, 33], [-124, 42]];
const OR_RING = [[-124, 46], [-117, 46], [-117, 42], [-124, 42], [-124, 46]];

const sources = {
  countriesGeo: null,
  statesGeo: null,
  risorgimentoGeo: null,
  admin50Geo: {
    type: 'FeatureCollection',
    features: [adminFeature('US-CA', CA_RING), adminFeature('US-OR', OR_RING)],
  } as GeoJSON.FeatureCollection,
};

const mapData = {
  map_id: 'community_admin1_test',
  canvas_width: 1000,
  canvas_height: 1000,
  projection_bounds: { minLng: -130, maxLng: -110, minLat: 30, maxLat: 50 },
  territories: [
    {
      territory_id: 'one_state', name: 'One', polygon: [[0, 0], [1, 0], [1, 1]],
      center_point: [0.5, 0.5] as [number, number], admin1: ['US-CA'],
      geo_polygon: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]] as [number, number][],
    },
    {
      territory_id: 'two_states', name: 'Two', polygon: [[0, 0], [1, 0], [1, 1]],
      center_point: [0.5, 0.5] as [number, number], admin1: ['US-CA', 'US-OR'],
      geo_polygon: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]] as [number, number][],
    },
    {
      territory_id: 'no_match', name: 'None', polygon: [[0, 0], [1, 0], [1, 1]],
      center_point: [0.5, 0.5] as [number, number], admin1: ['ZZ-ZZ'],
      geo_polygon: [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]] as [number, number][],
    },
  ],
};

describe('generic admin-1 geometry path', () => {
  const polys = buildTerritoryGlobeGeometries(
    mapData as Parameters<typeof buildTerritoryGlobeGeometries>[0],
    sources as Parameters<typeof buildTerritoryGlobeGeometries>[1],
  );
  const byId = Object.fromEntries(polys.map((p) => [p.territory_id, p]));

  it('a single admin1 code resolves to the real admin feature geometry', () => {
    const g = byId['one_state'].geometry;
    expect(g.type).toBe('Polygon');
    const flat = JSON.stringify(g.coordinates);
    expect(flat).toContain('-124'); // California's western edge, not the tiny geo_polygon
  });

  it('multiple admin1 codes union into one resolved geometry', () => {
    const g = byId['two_states'].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(g.type);
    expect(JSON.stringify(g.coordinates)).toContain('-124');
  });

  it('unmatched admin1 codes fall back to geo_polygon', () => {
    const flat = JSON.stringify(byId['no_match'].geometry.coordinates);
    expect(flat).toContain('5'); // the geo_polygon coords, not admin geometry
    expect(flat).not.toContain('-124');
  });
});

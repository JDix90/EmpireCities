import { describe, expect, it } from 'vitest';
import {
  buildTerritoryGlobeGeometries,
  buildTerritoryGlobeGeometriesShared,
  type GlobeGeometryInputs,
} from './globeTerritoryGeometry';

const NO_SOURCES: GlobeGeometryInputs = {
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

/** A small board of authored geo polygons: builds instantly, no Natural Earth. */
function board(mapId: string) {
  return {
    map_id: mapId,
    canvas_width: 20,
    canvas_height: 20,
    projection_bounds: { minLng: 0, maxLng: 20, minLat: 0, maxLat: 20 },
    territories: [
      {
        territory_id: `${mapId}_a`,
        name: 'A',
        polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
        center_point: [5, 5] as [number, number],
        geo_polygon: [[0, 10], [10, 10], [10, 20], [0, 20]] as [number, number][],
      },
      {
        territory_id: `${mapId}_b`,
        name: 'B',
        polygon: [[10, 0], [20, 0], [20, 10], [10, 10]],
        center_point: [15, 5] as [number, number],
        geo_polygon: [[10, 10], [20, 10], [20, 20], [10, 20]] as [number, number][],
      },
    ],
    connections: [{ from: `${mapId}_a`, to: `${mapId}_b`, type: 'land' }],
  };
}

/** What a resend delivers: the same content in new objects. */
const resent = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('buildTerritoryGlobeGeometriesShared', () => {
  it('builds what the plain build does', () => {
    const map = board('shared_same_result');
    expect(buildTerritoryGlobeGeometriesShared(map, NO_SOURCES)).toEqual(
      buildTerritoryGlobeGeometries(map, NO_SOURCES),
    );
  });

  it('hands a resent copy of the board the objects it already built', () => {
    // Same objects is what lets three-globe keep each territory's mesh.
    const first = buildTerritoryGlobeGeometriesShared(board('shared_resend'), NO_SOURCES);
    expect(buildTerritoryGlobeGeometriesShared(resent(board('shared_resend')), NO_SOURCES)).toBe(first);
  });

  it('ignores a connections-only change such as a new Launch Pad lane', () => {
    const first = buildTerritoryGlobeGeometriesShared(board('shared_lane'), NO_SOURCES);
    const withLane = board('shared_lane');
    withLane.connections.push({ from: 'shared_lane_b', to: 'moon_x', type: 'sea' });
    expect(buildTerritoryGlobeGeometriesShared(withLane, NO_SOURCES)).toBe(first);
  });

  it('rebuilds when a territory changes', () => {
    const first = buildTerritoryGlobeGeometriesShared(board('shared_moved'), NO_SOURCES);
    const moved = board('shared_moved');
    moved.territories[1].geo_polygon = [[10, 10], [20, 10], [20, 15], [10, 15]] as [number, number][];
    const next = buildTerritoryGlobeGeometriesShared(moved, NO_SOURCES);
    expect(next).not.toBe(first);
    expect(next).toEqual(buildTerritoryGlobeGeometries(moved, NO_SOURCES));
  });

  it('rebuilds when a different geo source is passed, not for the same one again', () => {
    const map = board('shared_sources');
    const countries: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const withCountries = { ...NO_SOURCES, countriesGeo: countries };
    const withoutSources = buildTerritoryGlobeGeometriesShared(map, NO_SOURCES);
    const withSources = buildTerritoryGlobeGeometriesShared(map, withCountries);
    expect(withSources).not.toBe(withoutSources);
    expect(buildTerritoryGlobeGeometriesShared(map, { ...withCountries })).toBe(withSources);
    // An equal but separate collection is another source: identity is the key.
    const copy: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    expect(buildTerritoryGlobeGeometriesShared(map, { ...NO_SOURCES, countriesGeo: copy })).not.toBe(withSources);
  });

  it('keeps a bounded number of boards, dropping the least recently used', () => {
    const kept = buildTerritoryGlobeGeometriesShared(board('shared_lru_kept'), NO_SOURCES);
    const dropped = buildTerritoryGlobeGeometriesShared(board('shared_lru_dropped'), NO_SOURCES);
    buildTerritoryGlobeGeometriesShared(board('shared_lru_1'), NO_SOURCES);
    // Using a board keeps it.
    expect(buildTerritoryGlobeGeometriesShared(board('shared_lru_kept'), NO_SOURCES)).toBe(kept);
    buildTerritoryGlobeGeometriesShared(board('shared_lru_2'), NO_SOURCES);
    expect(buildTerritoryGlobeGeometriesShared(board('shared_lru_kept'), NO_SOURCES)).toBe(kept);
    expect(buildTerritoryGlobeGeometriesShared(board('shared_lru_dropped'), NO_SOURCES)).not.toBe(dropped);
  });
});

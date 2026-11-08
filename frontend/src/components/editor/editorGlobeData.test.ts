import { describe, it, expect } from 'vitest';
import {
  TerritoryPolygonCache,
  buildCountryData,
  territoryGeometryKey,
  type EditorTerritory,
} from './editorGlobeData';
import { registerPossessionFeatures } from '../../utils/countryHomeland';

const square = (x: number, y: number, size = 1): [number, number][] => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size],
];

function drawn(id: string, ring: [number, number][], extra: Partial<EditorTerritory> = {}): EditorTerritory {
  return {
    territory_id: id,
    name: id,
    polygon: ring,
    center_point: [ring[0][0] + 0.5, ring[0][1] + 0.5],
    region_id: 'region_1',
    geo_polygon: ring,
    ...extra,
  };
}

function feature(iso: string, name: string, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Feature {
  return { type: 'Feature', properties: { ISO_A2: iso, NAME: name }, geometry };
}

const closed = (ring: [number, number][]): GeoJSON.Position[] => [...ring, ring[0]];

describe('TerritoryPolygonCache', () => {
  it('hands back the same datum object while the geometry is unchanged', () => {
    const cache = new TerritoryPolygonCache();
    const noCountries = new Map<string, GeoJSON.Feature[]>();
    const a = drawn('a', square(0, 0));
    const first = cache.build([a], noCountries);
    // A rename, a region move and a fresh array: none of them is a geometry change.
    const second = cache.build([{ ...a, name: 'Renamed', region_id: 'region_2' }], noCountries);
    expect(second[0]).toBe(first[0]);
    expect(second[0].geometry).toBe(first[0].geometry);
  });

  it('replaces the datum when the ring changes and drops territories that leave', () => {
    const cache = new TerritoryPolygonCache();
    const noCountries = new Map<string, GeoJSON.Feature[]>();
    const a = drawn('a', square(0, 0));
    const b = drawn('b', square(5, 5));
    const first = cache.build([a, b], noCountries);
    const moved = drawn('a', square(1, 1));
    const second = cache.build([moved], noCountries);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    expect(cache.size).toBe(1);
  });

  it('closes an open ring once and leaves a closed one alone', () => {
    const cache = new TerritoryPolygonCache();
    const noCountries = new Map<string, GeoJSON.Feature[]>();
    const [open] = cache.build([drawn('a', square(0, 0))], noCountries);
    expect((open.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5);
    const ring = square(0, 0);
    const [already] = cache.build([drawn('b', [...ring, ring[0]])], noCountries);
    expect((already.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5);
  });

  it('rebuilds a country territory when the country data arrives, then holds steady', () => {
    const cache = new TerritoryPolygonCache();
    const mali = drawn('mali', square(-5, 15), { iso_codes: ['ML'], geo_polygon: undefined });
    expect(territoryGeometryKey(mali, false)).toBe('none');
    // No countries yet and no ring to fall back on: nothing to draw.
    expect(cache.build([mali], new Map())).toHaveLength(0);

    const countries = new Map<string, GeoJSON.Feature[]>([
      ['ML', [feature('ML', 'Mali', { type: 'Polygon', coordinates: [closed(square(-5, 15, 5))] })]],
    ]);
    const first = cache.build([mali], countries);
    expect(first).toHaveLength(1);
    expect(territoryGeometryKey(mali, true)).toBe('iso:ML');
    const second = cache.build([{ ...mali, name: 'Mali Empire' }], countries);
    expect(second[0]).toBe(first[0]);
  });
});

describe('buildCountryData', () => {
  it('draws the homeland of a bare code and lists its overseas piece under its own code', () => {
    // Metropolitan France plus a box where French Guiana sits; Natural Earth
    // ships both in the FR feature.
    const fr: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [closed(square(0, 44, 5))],
        [closed(square(-54, 2, 2))],
      ],
    };
    const index = new Map<string, GeoJSON.Feature[]>([['FR', [feature('FR', 'France', fr)]]]);
    registerPossessionFeatures(index);
    const data = buildCountryData(index);
    const france = data.find((d) => d.isoCode === 'FR');
    const guiana = data.find((d) => d.isoCode === 'GF');
    expect(france?.countryName).toBe('France');
    expect(france?.geometry.type).toBe('Polygon');
    expect(guiana?.countryName).toBe('French Guiana');
    expect(guiana?.id).toBe('country_GF');
  });

  it('skips codes with no polygon geometry', () => {
    const index = new Map<string, GeoJSON.Feature[]>([
      ['XX', [{ type: 'Feature', properties: { ISO_A2: 'XX' }, geometry: { type: 'Point', coordinates: [0, 0] } }]],
    ]);
    expect(buildCountryData(index)).toHaveLength(0);
  });
});

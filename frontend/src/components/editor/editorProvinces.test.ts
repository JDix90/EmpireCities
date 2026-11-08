import { describe, it, expect } from 'vitest';
import { buildProvinceSplit, coveredCountryCodes, provinceCountry } from './editorProvinces';
import type { EditorTerritory } from './editorGlobeData';
import type { PolyGeom, Ring } from './editorGeo';
import type { ProvinceInfo } from '../../hooks/useEditorProvinces';

const square = (x: number, y: number, size = 1): Ring => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size],
];
const poly = (ring: Ring): PolyGeom => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

function province(code: string, name: string, ring: Ring): ProvinceInfo {
  return { code, name, countryCode: code.slice(0, 2), kind: 'State', label: [ring[0][0] + 0.5, ring[0][1] + 0.5], geometry: poly(ring) };
}

// A country of two provinces side by side; a neighbour country to the east
// of the second province; an island far to the north the author linked by sea.
const PARENT: EditorTerritory = {
  territory_id: 't_xx',
  name: 'Xandia',
  polygon: square(0, 0, 2),
  center_point: [1, 0.5],
  region_id: 'region_west',
  iso_codes: ['XX'],
};
const PROVINCES = [province('XX-A', 'Alpha', square(0, 0)), province('XX-B', 'Beta', square(1, 0))];
const OTHERS = [
  { id: 't_east', geometry: poly(square(2, 0)) },
  { id: 't_isle', geometry: poly(square(0, 8)) },
];

describe('buildProvinceSplit', () => {
  it('makes a territory per province in the parent region, bordered to each other and to the old neighbours', () => {
    const split = buildProvinceSplit({
      parent: PARENT,
      provinces: PROVINCES,
      others: OTHERS,
      existingIds: new Set(['t_xx', 't_east', 't_isle']),
      parentConnections: [
        { from: 't_xx', to: 't_east', type: 'land' },
        { from: 't_isle', to: 't_xx', type: 'sea' },
      ],
    });
    expect(split.territories.map((t) => [t.territory_id, t.name, t.region_id, t.admin1?.[0]])).toEqual([
      ['t_xx_a', 'Alpha', 'region_west', 'XX-A'],
      ['t_xx_b', 'Beta', 'region_west', 'XX-B'],
    ]);
    expect(split.territories[0].center_point).toEqual([0.5, 0.5]);
    const edges = split.connections.map((c) => `${c.from}>${c.to}:${c.type}`).sort();
    expect(edges).toEqual([
      't_xx_a>t_isle:sea', // the author's sea lane, handed to the nearest province
      't_xx_a>t_xx_b:land', // the internal border
      't_xx_b>t_east:land', // the neighbour only Beta touches
    ]);
  });

  it('never mints an id that is already taken', () => {
    const split = buildProvinceSplit({
      parent: PARENT,
      provinces: PROVINCES,
      others: [],
      existingIds: new Set(['t_xx_a']),
      parentConnections: [],
    });
    expect(split.territories.map((t) => t.territory_id)).toEqual(['t_xx_a_2', 't_xx_b']);
  });
});

describe('coveredCountryCodes / provinceCountry', () => {
  it('counts a country covered by whole code or by any of its provinces', () => {
    expect(provinceCountry('US-CA')).toBe('US');
    const covered = coveredCountryCodes([
      { iso_codes: ['FR'] },
      { admin1: ['US-CA', 'US-NV'] },
      {},
    ]);
    expect([...covered].sort()).toEqual(['FR', 'US']);
  });
});

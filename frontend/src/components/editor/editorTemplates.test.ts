import { describe, it, expect } from 'vitest';
import { buildTemplateFromCountries, continentOptions, foldThinRegions, slugId, type CountryInfo } from './editorTemplates';
import type { PolyGeom, Ring } from './editorGeo';
import { mapComponents } from '@borderfall/shared';

const square = (x: number, y: number, size = 1): Ring => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size],
];
const poly = (ring: Ring): PolyGeom => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

function country(code: string, name: string, subregion: string, ring: Ring, continent = 'Testland', areaKm2 = 12_000): CountryInfo {
  return { code, name, continent, subregion, areaKm2, label: [ring[0][0] + 0.5, ring[0][1] + 0.5], geometry: poly(ring) };
}

// A 2×2 block of bordering squares in the west, a lone island well to the east.
const WEST = [
  country('AA', 'Aa', 'Western', square(0, 0)),
  country('BB', 'Bb', 'Western', square(1, 0)),
  country('CC', 'Cc', 'Northern', square(0, 1)),
  country('DD', 'Dd', 'Northern', square(1, 1)),
];
const ISLAND = country('II', 'Isle', 'Islands', square(5, 0));

describe('buildTemplateFromCountries', () => {
  it('turns countries into territories with their borders, bridges the island, and prices regions', () => {
    const template = buildTemplateFromCountries([...WEST, ISLAND]);
    expect(template.territories.map((t) => t.territory_id)).toEqual(['t_aa', 't_bb', 't_cc', 't_dd', 't_ii']);
    expect(template.territories[0].iso_codes).toEqual(['AA']);
    expect(template.territories[0].center_point).toEqual([0.5, 0.5]);

    const land = template.connections.filter((c) => c.type === 'land');
    // The four shared edges of the block, plus the two diagonals that meet at
    // (1,1): a shared vertex is a border to the topology test, as at a quadripoint.
    expect(land).toHaveLength(6);
    const ids = template.territories.map((t) => t.territory_id);
    expect(mapComponents(ids, template.connections)).toHaveLength(1);
    const bridge = template.connections.find((c) => c.to === 't_ii' || c.from === 't_ii');
    expect(bridge?.type).toBe('sea');
    expect([bridge?.from, bridge?.to]).toContain('t_bb'); // the nearest coast: x = 2

    // The island's one-member subregion folded into the region it reaches.
    expect(template.regions.map((r) => r.region_id).sort()).toEqual(['region_northern', 'region_western']);
    expect(template.territories.find((t) => t.territory_id === 't_ii')?.region_id).toBe('region_western');
    for (const r of template.regions) expect(r.bonus).toBeGreaterThanOrEqual(1);
  });
});

describe('foldThinRegions', () => {
  it('moves a lone member to the largest bordering region and drops the empty one', () => {
    const territories = [
      { territory_id: 'a', name: 'a', polygon: [], center_point: [0, 0] as [number, number], region_id: 'big' },
      { territory_id: 'b', name: 'b', polygon: [], center_point: [0, 0] as [number, number], region_id: 'big' },
      { territory_id: 'c', name: 'c', polygon: [], center_point: [0, 0] as [number, number], region_id: 'lone' },
    ];
    const regions = foldThinRegions(territories, [{ from: 'b', to: 'c', type: 'land' }], [
      { region_id: 'big', name: 'Big', bonus: 1 },
      { region_id: 'lone', name: 'Lone', bonus: 1 },
    ]);
    expect(regions.map((r) => r.region_id)).toEqual(['big']);
    expect(territories[2].region_id).toBe('big');
  });
});

describe('continentOptions / slugId', () => {
  it('counts large and small countries per continent and skips the oceans', () => {
    const options = continentOptions([
      ...WEST,
      country('SS', 'Small', 'Western', square(9, 9), 'Testland', 400),
      country('OO', 'Ocean', 'Open', square(20, 20), 'Seven seas (open ocean)'),
    ]);
    expect(options).toEqual([{ name: 'Testland', large: 4, small: 1 }]);
  });

  it('makes server-safe ids from names', () => {
    expect(slugId('region', 'South-Eastern Asia')).toBe('region_south_eastern_asia');
    expect(slugId('t', 'GF')).toBe('t_gf');
    expect(slugId('t', '***')).toBe('t_x');
  });
});

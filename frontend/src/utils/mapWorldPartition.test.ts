import { describe, it, expect } from 'vitest';
import { filterMapToWorld, orbitStubsForWorld, worldIdsOnMap, type WorldPartitionMap } from './mapWorldPartition';

/**
 * The Space Age map authors its lunar tiles in the same canvas space as Earth
 * and gives them Earth-referenced geo_polygon placeholders, so an unfiltered 2D
 * render drew the Moon on top of the Atlantic, Africa and Australia.
 */

const spaceAge: WorldPartitionMap = {
  canvas_width: 1200,
  canvas_height: 800,
  projection_bounds: { minLat: -60, maxLat: 85 },
  territories: [
    {
      territory_id: 'na_launch_base', region_id: 'north_america_2100',
      polygon: [[100, 100], [200, 100], [200, 200], [100, 200]],
      geo_polygon: [[-80, 28], [-79, 28]], iso_codes: ['US'],
    },
    {
      territory_id: 'euro_spaceport', region_id: 'europe_2100',
      polygon: [[600, 130], [680, 130], [680, 198], [600, 198]],
      geo_polygon: [[2, 48]],
    },
    {
      territory_id: 'moon_near_side_north', region_id: 'lunar_surface', globe_id: 'moon',
      polygon: [[400, 24], [800, 24], [800, 217], [400, 217]],
      // Placeholder Earth lat/lng: projecting these puts the Moon over Europe.
      geo_polygon: [[-78, 46], [78, 60]], iso_codes: ['XX'], admin1: [{ id: 'a' }],
    },
    {
      territory_id: 'moon_mare_imbrium', region_id: 'lunar_surface', globe_id: 'moon',
      polygon: [[400, 300], [800, 300], [800, 500], [400, 500]],
      geo_polygon: [[-40, 20]],
    },
  ],
  connections: [
    { from: 'na_launch_base', to: 'euro_spaceport', type: 'land' },
    { from: 'na_launch_base', to: 'moon_near_side_north', type: 'orbit' },
    { from: 'moon_near_side_north', to: 'moon_mare_imbrium', type: 'land' },
    { from: 'euro_spaceport', to: 'moon_mare_imbrium', type: 'orbit', source: 'launch_pad' },
  ],
  regions: [
    { region_id: 'north_america_2100', name: 'North America' },
    { region_id: 'europe_2100', name: 'Europe' },
    { region_id: 'lunar_surface', name: 'Lunar Surface' },
  ],
};

describe('filterMapToWorld', () => {
  it('keeps only Earth tiles and their internal connections', () => {
    const earth = filterMapToWorld(spaceAge, 'earth');
    expect(earth.territories.map((t) => t.territory_id)).toEqual(['na_launch_base', 'euro_spaceport']);
    // Both orbit lanes cross worlds, so neither survives as a drawable line.
    expect(earth.connections).toEqual([{ from: 'na_launch_base', to: 'euro_spaceport', type: 'land' }]);
    expect(earth.regions?.map((r) => r.region_id)).toEqual(['north_america_2100', 'europe_2100']);
  });

  it('keeps only Moon tiles and their internal connections', () => {
    const moon = filterMapToWorld(spaceAge, 'moon');
    expect(moon.territories.map((t) => t.territory_id)).toEqual(['moon_near_side_north', 'moon_mare_imbrium']);
    expect(moon.connections).toEqual([
      { from: 'moon_near_side_north', to: 'moon_mare_imbrium', type: 'land' },
    ]);
    expect(moon.regions?.map((r) => r.region_id)).toEqual(['lunar_surface']);
  });

  it('strips the geo hints from off-world tiles so they are not projected onto Earth', () => {
    const moon = filterMapToWorld(spaceAge, 'moon');
    for (const t of moon.territories) {
      expect(t.geo_polygon).toBeUndefined();
      expect(t.iso_codes).toBeUndefined();
      expect(t.admin1).toBeUndefined();
    }
    // Earth keeps its real geography.
    expect(filterMapToWorld(spaceAge, 'earth').territories[0].geo_polygon).toBeDefined();
  });

  it('drops the authored canvas size off-world so the inset fits the tiles it was given', () => {
    const moon = filterMapToWorld(spaceAge, 'moon');
    expect(moon.canvas_width).toBeUndefined();
    expect(moon.canvas_height).toBeUndefined();
    expect(moon.projection_bounds).toBeUndefined();
    const earth = filterMapToWorld(spaceAge, 'earth');
    expect(earth.canvas_width).toBe(1200);
  });

  it('returns an Earth-only map untouched', () => {
    const earthOnly: WorldPartitionMap = {
      territories: [{ territory_id: 'a', region_id: 'r', polygon: [[0, 0]] }],
      connections: [],
    };
    expect(filterMapToWorld(earthOnly, 'earth')).toBe(earthOnly);
  });

  it('yields an empty map for a world that is not on it', () => {
    const mars = filterMapToWorld(spaceAge, 'mars');
    expect(mars.territories).toEqual([]);
    expect(mars.connections).toEqual([]);
  });
});

describe('orbitStubsForWorld', () => {
  it('reports each crossing lane from the Earth side', () => {
    expect(orbitStubsForWorld(spaceAge, 'earth')).toEqual([
      { fromId: 'na_launch_base', toId: 'moon_near_side_north', toWorldId: 'moon', source: undefined },
      { fromId: 'euro_spaceport', toId: 'moon_mare_imbrium', toWorldId: 'moon', source: 'launch_pad' },
    ]);
  });

  it('reports the same lanes reversed from the Moon side', () => {
    expect(orbitStubsForWorld(spaceAge, 'moon')).toEqual([
      { fromId: 'moon_near_side_north', toId: 'na_launch_base', toWorldId: 'earth', source: undefined },
      { fromId: 'moon_mare_imbrium', toId: 'euro_spaceport', toWorldId: 'earth', source: 'launch_pad' },
    ]);
  });

  it('ignores land and sea connections', () => {
    const landOnly: WorldPartitionMap = {
      territories: [
        { territory_id: 'a', region_id: 'r', polygon: [[0, 0]] },
        { territory_id: 'b', region_id: 'r', polygon: [[1, 1]] },
      ],
      connections: [{ from: 'a', to: 'b', type: 'sea' }],
    };
    expect(orbitStubsForWorld(landOnly, 'earth')).toEqual([]);
  });
});

describe('worldIdsOnMap', () => {
  it('lists Earth first', () => {
    expect(worldIdsOnMap(spaceAge)).toEqual(['earth', 'moon']);
  });
});

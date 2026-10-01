import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

describe('filterMapToWorld · galaxy boards', () => {
  const galaxy = {
    canvas_width: 1200,
    canvas_height: 700,
    projection_bounds: { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 },
    territories: [
      { territory_id: 'sol_a', region_id: 'sol_r', world_id: 'sol', polygon: [[0, 0], [1, 0], [1, 1]] as Array<[number, number]>, geo_polygon: [[0, 0]] },
      { territory_id: 'verdan_a', region_id: 'verdan_r', world_id: 'verdan', polygon: [[0, 0], [1, 0], [1, 1]] as Array<[number, number]>, geo_polygon: [[1, 1]] },
    ],
    connections: [{ from: 'sol_a', to: 'verdan_a', type: 'orbit' as const }],
  };

  it('treats Sol III like Earth: keeps its geo hints and the authored canvas', () => {
    const sol = filterMapToWorld(galaxy, 'sol');
    expect(sol.territories.map((t) => t.territory_id)).toEqual(['sol_a']);
    expect(sol.territories[0].geo_polygon).toBeDefined();
    expect(sol.canvas_width).toBe(1200);
    expect(sol.projection_bounds).toBeDefined();
  });

  it("strips a far world's geo hints so it draws its own rings in its own frame", () => {
    const verdan = filterMapToWorld(galaxy, 'verdan');
    expect(verdan.territories.map((t) => t.territory_id)).toEqual(['verdan_a']);
    expect(verdan.territories[0].geo_polygon).toBeUndefined();
    expect(verdan.canvas_width).toBeUndefined();
  });

  it("moves a far world authored away from the corner to its own frame's origin", () => {
    // GameMap sizes the canvas to the tiles' box but scales from (0, 0): left
    // where it was authored, this world ran off the right of the canvas.
    const nexus = {
      territories: [
        { territory_id: 'n1', region_id: 'n', world_id: 'nexus_station', polygon: [[384, 100], [500, 72], [520, 200]] as Array<[number, number]>, center_point: [470, 130] },
        { territory_id: 'n2', region_id: 'n', world_id: 'nexus_station', polygon: [[700, 400], [867, 410], [800, 628]] as Array<[number, number]>, center_point: [790, 480] },
      ],
      connections: [],
    };
    const framed = filterMapToWorld(nexus, 'nexus_station');
    expect(framed.territories.map((t) => t.polygon)).toEqual([
      [[0, 28], [116, 0], [136, 128]],
      [[316, 328], [483, 338], [416, 556]],
    ]);
    expect(framed.territories.map((t) => t.center_point)).toEqual([[86, 58], [406, 408]]);
    // The source map is left as it was.
    expect(nexus.territories[0].polygon[0]).toEqual([384, 100]);
  });

  it("frames a galaxy world with a margin, so its rim stays on the canvas", () => {
    const board = {
      map_kind: 'galaxy',
      canvas_width: 1200,
      canvas_height: 700,
      territories: [
        { territory_id: 'r1', region_id: 'r', world_id: 'rust', polygon: [[11, 115], [400, 115], [400, 300]] as Array<[number, number]>, center_point: [300, 200] },
        { territory_id: 'r2', region_id: 'r', world_id: 'rust', polygon: [[500, 400], [860, 663], [600, 600]] as Array<[number, number]>, center_point: [650, 550] },
      ],
      connections: [],
    };
    const rust = filterMapToWorld(board, 'rust');
    // The box is 849 × 548; a 6% margin of its larger side is 51 on every side.
    expect([rust.canvas_width, rust.canvas_height]).toEqual([849 + 102, 548 + 102]);
    expect(rust.territories[0].polygon[0]).toEqual([51, 51]);
    expect(rust.territories[1].polygon[1]).toEqual([849 + 51, 548 + 51]);
    expect(rust.territories[0].center_point).toEqual([300 - 11 + 51, 200 - 115 + 51]);
  });

  it('leaves the Space Age Moon where it was authored, at the corner', () => {
    const map = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_space_age.json'), 'utf8')) as WorldPartitionMap;
    const authored = map.territories.filter((t) => t.region_id === 'lunar_surface');
    expect(authored.length).toBeGreaterThan(0);
    const moon = filterMapToWorld(map, 'moon');
    expect(moon.territories.map((t) => t.polygon)).toEqual(authored.map((t) => t.polygon));
  });
});

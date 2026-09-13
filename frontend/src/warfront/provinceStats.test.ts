import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell } from '@borderfall/warfront-sim';
import { biomeName, computeProvinceStats, percent } from './provinceStats';

const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
const plains = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
const forest = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Forest });
const ridge = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });
const ford = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.River, ford: true });
const beach = packCell({ owner: 2, tier: 0, passable: true, biome: Biome.Plains, beach: true });
const pass = packCell({ owner: 2, tier: 1, passable: true, biome: Biome.Highland, pass: true });

/** 4x2: Gaul across the top, Italia across the bottom. */
function grid(): TerrainGrid {
  const cells = Uint16Array.from([plains, forest, ridge, ford, beach, pass, sea, sea]);
  return new TerrainGrid(4, 2, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'italia_north', name: 'Italia Cisalpina' },
    ],
    lanes: [{ from: 'italia_north', to: 'sardinia_corsica' }],
  });
}

describe('computeProvinceStats', () => {
  it('counts cells, passability and biomes per province', () => {
    const [gaul, italia] = computeProvinceStats(grid());
    expect(gaul.territoryId).toBe('lugdunensis');
    expect(gaul.cells).toBe(4);
    expect(gaul.passable).toBe(3); // the ridge is impassable
    expect(gaul.biomes[Biome.Plains]).toBe(1);
    expect(gaul.biomes[Biome.Forest]).toBe(1);
    expect(gaul.biomes[Biome.Mountain]).toBe(1);
    expect(gaul.highland).toBe(1);
    expect(gaul.fords).toBe(1);
    expect(italia.cells).toBe(2);
    expect(italia.beaches).toBe(1);
    expect(italia.passes).toBe(1);
  });

  it('carries the map\'s own sea lanes, in both directions', () => {
    const [, italia] = computeProvinceStats(grid());
    expect(italia.lanes).toEqual(['sardinia_corsica']);
  });

  it('puts every centre cell inside its own province', () => {
    const g = grid();
    for (const stats of computeProvinceStats(g)) {
      expect(stats.centerCell).toBeGreaterThanOrEqual(0);
      expect(g.owner(stats.centerCell)).toBe(stats.index);
    }
  });

  it('snaps the centre onto the province even when the centroid is not on it', () => {
    // A C-shape: the centre of mass falls in the hollow, which belongs to nobody.
    const cells = Uint16Array.from([plains, plains, plains, plains, sea, sea, plains, plains, plains]);
    const g = new TerrainGrid(3, 3, cells, {
      provinces: [{ index: 1, territory_id: 'c_shape', name: 'C' }],
    });
    const [stats] = computeProvinceStats(g);
    expect(g.owner(stats.centerCell)).toBe(1);
  });

  it('returns a province with no cells rather than omitting it', () => {
    const g = new TerrainGrid(2, 1, Uint16Array.from([sea, sea]), {
      provinces: [{ index: 1, territory_id: 'ghost', name: 'Ghost' }],
    });
    const [stats] = computeProvinceStats(g);
    expect(stats.cells).toBe(0);
    expect(stats.centerCell).toBe(-1);
  });
});

describe('helpers', () => {
  it('names biomes and computes whole percentages safely', () => {
    expect(biomeName(Biome.Forest)).toBe('forest');
    expect(biomeName(99)).toBe('unknown');
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBe(0);
  });
});

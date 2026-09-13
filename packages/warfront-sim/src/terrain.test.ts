import { describe, it, expect } from 'vitest';
import {
  Biome,
  TerrainGrid,
  cellBiome,
  cellOwner,
  cellPassable,
  cellTier,
  decodeTerrainRows,
  encodeTerrainRows,
  packCell,
  terrainChecksum,
  type TerrainAsset,
} from './terrain';
import { Rng } from './rng';

function syntheticGrid(width: number, height: number, seed: number): Uint16Array {
  const rng = new Rng(seed);
  const cells = new Uint16Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    const sea = rng.chance(1, 5);
    cells[i] = packCell({
      owner: sea ? 0 : rng.nextRange(1, 3),
      tier: rng.chance(1, 4) ? 1 : 0,
      passable: !sea,
      biome: sea ? Biome.Sea : Biome.Plains,
      ford: rng.chance(1, 20),
      beach: rng.chance(1, 10),
    });
  }
  return cells;
}

describe('cell packing', () => {
  it('round-trips every field', () => {
    const v = packCell({ owner: 17, tier: 1, passable: true, biome: Biome.River, ford: true, beach: false, pass: true });
    expect(cellOwner(v)).toBe(17);
    expect(cellTier(v)).toBe(1);
    expect(cellPassable(v)).toBe(true);
    expect(cellBiome(v)).toBe(Biome.River);
    expect(v & (1 << 10)).toBeTruthy();
    expect(v & (1 << 11)).toBeFalsy();
    expect(v & (1 << 12)).toBeTruthy();
  });
});

describe('row codec', () => {
  it('encodes runs and decodes them back exactly', () => {
    const cells = syntheticGrid(37, 11, 4);
    const rows = encodeTerrainRows(cells, 37, 11);
    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.length % 2).toBe(0);
      let total = 0;
      for (let i = 1; i < row.length; i += 2) total += row[i];
      expect(total).toBe(37);
    }
    const back = decodeTerrainRows(rows, 37, 11);
    expect(Array.from(back)).toEqual(Array.from(cells));
  });

  it('rejects malformed rows', () => {
    expect(() => decodeTerrainRows([[1, 2, 3]], 3, 1)).toThrow(/odd run list/);
    expect(() => decodeTerrainRows([[1, 2]], 3, 1)).toThrow(/covers 2 cells/);
    expect(() => decodeTerrainRows([[1, 4]], 3, 1)).toThrow(/overflows/);
    expect(() => decodeTerrainRows([[1, 3]], 3, 2)).toThrow(/has 1 rows/);
    expect(() => decodeTerrainRows([[70000, 3]], 3, 1)).toThrow(/out of range/);
  });
});

describe('TerrainGrid', () => {
  it('decodes an asset and verifies its checksum', () => {
    const cells = syntheticGrid(20, 10, 9);
    const asset: TerrainAsset = {
      format: 'warfront-terrain',
      version: 1,
      map_id: 'test',
      generator: 'test',
      cell_km: 4,
      width: 20,
      height: 10,
      bounds_e6: { min_lng_e6: -1000000, max_lng_e6: 1000000, min_lat_e6: 40000000, max_lat_e6: 41000000 },
      lat0_e6: 40500000,
      provinces: [{ index: 1, territory_id: 'a', name: 'A' }],
      lanes: [],
      rows: encodeTerrainRows(cells, 20, 10),
      checksum: terrainChecksum(cells, 20, 10),
    };
    const grid = TerrainGrid.decode(asset);
    expect(grid.size).toBe(200);
    expect(grid.checksum()).toBe(asset.checksum);
    expect(grid.provinceIndex('a')).toBe(1);
    expect(grid.provinceIndex('zzz')).toBe(0);
    expect(() => TerrainGrid.decode({ ...asset, checksum: '0000000000000000' })).toThrow(/checksum mismatch/);
    expect(() => TerrainGrid.decode({ ...asset, version: 2 } as unknown as TerrainAsset)).toThrow(/not a warfront-terrain/);
  });

  it('maps micro-degree lon/lat to cells with exact arithmetic', () => {
    const cells = new Uint16Array(20 * 10);
    const grid = new TerrainGrid(20, 10, cells, {
      boundsE6: { min_lng_e6: -1000000, max_lng_e6: 1000000, min_lat_e6: 40000000, max_lat_e6: 41000000 },
    });
    expect(grid.colForLngE6(-1000000)).toBe(0);
    expect(grid.colForLngE6(999999)).toBe(19);
    expect(grid.colForLngE6(1000000)).toBe(-1);
    expect(grid.rowForLatE6(41000000)).toBe(0);
    expect(grid.rowForLatE6(40000001)).toBe(9);
    expect(grid.cellForLngLatE6(0, 40500000)).toBe(grid.index(10, 5));
    expect(grid.cellForLngLatE6(5000000, 40500000)).toBe(-1);
  });

  it('finds the nearest passable cell in a fixed ring order', () => {
    const w = 9;
    const h = 9;
    const cells = new Uint16Array(w * h).fill(packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea }));
    const grid = new TerrainGrid(w, h, cells);
    expect(grid.nearestPassable(grid.index(4, 4), 3)).toBe(-1);
    cells[grid.index(6, 5)] = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
    cells[grid.index(2, 3)] = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
    // Both candidates sit on ring 2; the scan runs rows north to south, so (2,3) wins.
    expect(grid.nearestPassable(grid.index(4, 4), 3)).toBe(grid.index(2, 3));
    cells[grid.index(5, 4)] = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
    expect(grid.nearestPassable(grid.index(4, 4), 3)).toBe(grid.index(5, 4));
    expect(grid.nearestPassable(grid.index(5, 4), 3)).toBe(grid.index(5, 4));
  });

  it('refuses grids the flow field cannot index', () => {
    expect(() => new TerrainGrid(2048, 1025, new Uint16Array(2048 * 1025))).toThrow(/exceeds/);
  });
});

import { describe, it, expect } from 'vitest';
import { Biome, TerrainGrid, packCell, toIntFloor } from '@borderfall/warfront-sim';
import { SANDBOX_SPEED, buildSandboxScenario } from './sandboxScenario';

const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
const gaul = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
const gaulMountain = packCell({ owner: 1, tier: 1, passable: false, biome: Biome.Mountain });
const italia = packCell({ owner: 2, tier: 0, passable: true, biome: Biome.Plains });

/** 8x4: a band of Gaul (with one impassable ridge) on the left, Italia on the right. */
function testGrid(): TerrainGrid {
  const width = 8;
  const height = 4;
  const cells = new Uint16Array(width * height).fill(sea);
  for (let r = 1; r < 3; r++) {
    for (let c = 1; c < 4; c++) cells[r * width + c] = gaul;
    for (let c = 5; c < 7; c++) cells[r * width + c] = italia;
  }
  cells[1 * width + 2] = gaulMountain;
  return new TerrainGrid(width, height, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'italia_north', name: 'Italia Cisalpina' },
    ],
  });
}

describe('buildSandboxScenario', () => {
  it('musters only on passable cells of the named province', () => {
    const grid = testGrid();
    const { scenario } = buildSandboxScenario(grid, { territoryId: 'lugdunensis', count: 4 });
    expect(scenario.units).toHaveLength(4);
    for (const u of scenario.units) {
      const cell = grid.index(toIntFloor(u.x), toIntFloor(u.y));
      expect(grid.isPassable(cell)).toBe(true);
      expect(grid.owner(cell)).toBe(1);
      expect(u.speed).toBe(SANDBOX_SPEED);
    }
  });

  it('is deterministic, so a replay recorded here reproduces', () => {
    const a = buildSandboxScenario(testGrid(), { territoryId: 'lugdunensis', count: 4 });
    const b = buildSandboxScenario(testGrid(), { territoryId: 'lugdunensis', count: 4 });
    expect(a).toEqual(b);
  });

  it('places units on whole-integer fixed coordinates', () => {
    const { scenario } = buildSandboxScenario(testGrid(), { territoryId: 'lugdunensis', count: 3 });
    for (const u of scenario.units) {
      expect(Number.isInteger(u.x)).toBe(true);
      expect(Number.isInteger(u.y)).toBe(true);
    }
  });

  it('never asks for more units than the province can hold', () => {
    const { scenario } = buildSandboxScenario(testGrid(), { territoryId: 'lugdunensis', count: 999 });
    // Gaul has 6 cells, one of which is an impassable ridge.
    expect(scenario.units).toHaveLength(5);
  });

  it('fails loudly when the province is not in the asset', () => {
    expect(() => buildSandboxScenario(testGrid(), { territoryId: 'atlantis', count: 1 })).toThrow(/no province/);
  });

  it('reports a mustering cell the camera can open on', () => {
    const grid = testGrid();
    const { originCell } = buildSandboxScenario(grid, { territoryId: 'lugdunensis', count: 2 });
    expect(grid.isPassable(originCell)).toBe(true);
    expect(grid.owner(originCell)).toBe(1);
  });
});

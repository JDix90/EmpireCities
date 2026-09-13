import { describe, it, expect } from 'vitest';
import { Biome, BuildingKind, Sim, TerrainGrid, UnitKind, cellCentre, packCell } from '@borderfall/warfront-sim';
import { buildingAtPoint, cellAtPoint } from './picking';

const WIDTH = 8;
const ROW = 1;

function testGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    cells[ROW * WIDTH + c] = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });
  }
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [{ index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' }],
  });
}

function testSim() {
  return new Sim({
    seed: 1,
    terrain: testGrid(),
    scenario: {
      players: [{ index: 1, food: 100, timber: 100, silver: 0 }],
      buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: ROW * WIDTH + 2 }],
      units: [{ owner: 1, kind: UnitKind.Villager, x: cellCentre(2), y: cellCentre(ROW), speed: 1 }],
    },
  });
}

describe('buildingAtPoint', () => {
  it('picks the building on the cell under the cursor, anywhere in that cell', () => {
    const sim = testSim();
    const grid = sim.terrain!;
    expect(buildingAtPoint(sim, grid, 2.5, 1.5)).toBe(1);
    expect(buildingAtPoint(sim, grid, 2.01, 1.99)).toBe(1);
  });

  it('picks nothing from the neighbouring cell — a building is one cell, not a radius', () => {
    const sim = testSim();
    const grid = sim.terrain!;
    expect(buildingAtPoint(sim, grid, 3.5, 1.5)).toBeNull();
    expect(buildingAtPoint(sim, grid, 1.99, 1.5)).toBeNull();
  });

  it('picks nothing off the grid', () => {
    const sim = testSim();
    const grid = sim.terrain!;
    expect(buildingAtPoint(sim, grid, -5, -5)).toBeNull();
    expect(buildingAtPoint(sim, grid, 1e6, 1e6)).toBeNull();
  });
});

describe('cellAtPoint', () => {
  it('floors to the cell containing the point', () => {
    const grid = testGrid();
    expect(cellAtPoint(grid, 3.9, 1.1)).toBe(grid.index(3, 1));
    expect(cellAtPoint(grid, 0, 0)).toBe(grid.index(0, 0));
  });

  it('returns -1 outside the world rather than a wrapped index', () => {
    const grid = testGrid();
    expect(cellAtPoint(grid, -0.1, 1)).toBe(-1);
    expect(cellAtPoint(grid, WIDTH, 1)).toBe(-1);
  });
});

import { describe, it, expect } from 'vitest';
import {
  Biome,
  BuildingKind,
  START_FOOD,
  START_SCOUTS,
  START_SILVER,
  START_TIMBER,
  START_VILLAGERS,
  Sim,
  TerrainGrid,
  UnitKind,
  packCell,
  toIntFloor,
} from '@borderfall/warfront-sim';
import { buildOpeningScenario, speedOf } from './matchScenario';

const WIDTH = 12;

/** Two provinces on row 1, sea everywhere else. */
function testGrid(): TerrainGrid {
  const height = 3;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    cells[1 * WIDTH + c] = packCell({
      owner: c < 6 ? 1 : 2,
      tier: 0,
      passable: true,
      biome: Biome.Plains,
    });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'belgica', name: 'Gallia Belgica' },
    ],
  });
}

describe('buildOpeningScenario', () => {
  it("opens with the brief's stock: a seat, four villagers and a scout", () => {
    const { scenario } = buildOpeningScenario(testGrid(), { territoryId: 'lugdunensis' });
    expect(scenario.players).toEqual([{ index: 1, food: START_FOOD, timber: START_TIMBER, silver: START_SILVER }]);
    expect(scenario.buildings).toHaveLength(1);
    expect(scenario.buildings![0].kind).toBe(BuildingKind.Seat);
    expect(scenario.units.filter((u) => u.kind === UnitKind.Villager)).toHaveLength(START_VILLAGERS);
    expect(scenario.units.filter((u) => u.kind === UnitKind.Scout)).toHaveLength(START_SCOUTS);
  });

  it('plants the seat on walkable ground inside the named province', () => {
    const grid = testGrid();
    const { seatCell } = buildOpeningScenario(grid, { territoryId: 'lugdunensis' });
    expect(grid.isPassable(seatCell)).toBe(true);
    expect(grid.owner(seatCell)).toBe(1);
  });

  it('is deterministic — the same grid gives the same opening every time', () => {
    const a = buildOpeningScenario(testGrid(), { territoryId: 'lugdunensis' });
    const b = buildOpeningScenario(testGrid(), { territoryId: 'lugdunensis' });
    expect(b).toEqual(a);
  });

  it('gives each unit its own table pace, not a placeholder', () => {
    const { scenario } = buildOpeningScenario(testGrid(), { territoryId: 'lugdunensis' });
    const scout = scenario.units.find((u) => u.kind === UnitKind.Scout)!;
    const villager = scenario.units.find((u) => u.kind === UnitKind.Villager)!;
    expect(scout.speed).toBe(speedOf(UnitKind.Scout));
    expect(villager.speed).toBe(speedOf(UnitKind.Villager));
    expect(scout.speed).toBeGreaterThan(villager.speed);
  });

  it('is accepted by the simulation, and the seat takes its province from tick zero', () => {
    const grid = testGrid();
    const { scenario, seatCell } = buildOpeningScenario(grid, { territoryId: 'lugdunensis' });
    const sim = new Sim({ seed: 1, scenario, terrain: grid });
    expect(sim.hasEconomy).toBe(true);
    expect(sim.provinces.get(1)!.owner).toBe(1);
    expect(sim.provinces.get(2)!.owner).toBe(0);
    for (const unit of sim.entities.all()) {
      expect(grid.index(toIntFloor(unit.x), toIntFloor(unit.y))).toBe(seatCell);
    }
  });

  it('refuses a province the asset does not have, rather than opening an empty match', () => {
    expect(() => buildOpeningScenario(testGrid(), { territoryId: 'atlantis' })).toThrow(/no province/);
  });
});

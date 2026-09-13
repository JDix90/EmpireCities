import { describe, it, expect } from 'vitest';
import {
  Biome,
  BUILDING_SPECS,
  BuildingKind,
  COLONISE_BASE_FOOD,
  Resource,
  Sim,
  TerrainGrid,
  UnitKind,
  cellCentre,
  packCell,
} from '@borderfall/warfront-sim';
import {
  BUILDABLE,
  buildOptions,
  buildingView,
  buildingsInProvince,
  coloniseView,
  provinceHolding,
  resourceView,
  trainOptions,
} from './economyView';

/**
 * A 12x3 strip: province 1 on the left half, province 2 on the right, with one forest
 * cell and one highland cell so the biome rules have something to refuse.
 */
const WIDTH = 12;
const ROW = 1;
const FOREST_COL = 2;
const HIGHLAND_COL = 3;

function testGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    const biome = c === FOREST_COL ? Biome.Forest : c === HIGHLAND_COL ? Biome.Highland : Biome.Plains;
    cells[ROW * WIDTH + c] = packCell({
      owner: c < 6 ? 1 : 2,
      tier: biome === Biome.Highland ? 1 : 0,
      passable: true,
      biome,
    });
  }
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [
      { index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 2, territory_id: 'belgica', name: 'Gallia Belgica' },
    ],
  });
}

const cellAt = (col: number) => ROW * WIDTH + col;

function sim(options: { villagerCols?: number[]; food?: number; timber?: number; silver?: number } = {}) {
  return new Sim({
    seed: 3,
    terrain: testGrid(),
    scenario: {
      players: [{ index: 1, food: options.food ?? 500, timber: options.timber ?? 500, silver: options.silver ?? 500 }],
      buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: cellAt(1) }],
      units: (options.villagerCols ?? [1]).map((col) => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(ROW),
        speed: 1 << 14,
      })),
    },
  });
}

describe('resourceView', () => {
  it('reports the stockpile, the upkeep it owes and the next colony price', () => {
    const view = resourceView(sim({ villagerCols: [1, 2] }), 1)!;
    expect(view.food).toBe(500);
    expect(view.provinces).toBe(1);
    // Two villagers at 3 food a minute each — the number that makes an army a cost.
    expect(view.upkeepPerMinute).toBe(6);
    // One province held already, so the next one is past the base price.
    expect(view.nextColonisePrice).toBeGreaterThan(COLONISE_BASE_FOOD);
  });

  it('is null for a seat that is not in the match', () => {
    expect(resourceView(sim(), 9)).toBeNull();
  });
});

describe('buildingView', () => {
  it('counts workers that are PRESENT, not merely assigned', () => {
    const s = sim({ villagerCols: [1, 5] });
    const farm = s.buildings.place({ owner: 1, kind: BuildingKind.Farm, cell: cellAt(1), complete: true });
    s.issue({ type: 'assign', unit: 2, building: farm.id });
    s.run(3);
    const view = buildingView(s, s.buildings.get(farm.id)!);
    expect(view.workersAssigned).toBe(1);
    // Assigned but four cells away and still walking: it earns nothing yet, and the panel
    // must not claim otherwise.
    expect(view.workersPresent).toBe(0);
    expect(view.yieldPerMinute).toBe(0);
  });

  it('reports a producing building at the rate it is actually paying', () => {
    const s = sim({ villagerCols: [1] });
    const farm = s.buildings.place({ owner: 1, kind: BuildingKind.Farm, cell: cellAt(1), complete: true });
    s.issue({ type: 'assign', unit: 1, building: farm.id });
    s.run(3);
    const view = buildingView(s, s.buildings.get(farm.id)!);
    expect(view.workersPresent).toBe(1);
    expect(view.produces).toBe(Resource.Food);
    expect(view.yieldPerMinute).toBe(BUILDING_SPECS[BuildingKind.Farm].yieldPerMinute);
  });

  it('shows construction as a percentage, and a finished building as 100', () => {
    const s = sim();
    const site = s.buildings.place({ owner: 1, kind: BuildingKind.Farm, cell: cellAt(4) });
    expect(buildingView(s, site).progressPercent).toBe(0);
    expect(buildingView(s, s.buildings.get(1)!).progressPercent).toBe(100);
  });

  it('lists only what stands in the province asked about', () => {
    const s = sim();
    s.buildings.place({ owner: 2, kind: BuildingKind.Farm, cell: cellAt(8), complete: true });
    expect(buildingsInProvince(s, 1).map((b) => b.kind)).toEqual([BuildingKind.Seat]);
    expect(buildingsInProvince(s, 2).map((b) => b.kind)).toEqual([BuildingKind.Farm]);
    expect(buildingsInProvince(s, 0)).toEqual([]);
  });
});

describe('provinceHolding', () => {
  it('says who holds it, and that unsettled ground is up for the taking', () => {
    const s = sim();
    expect(provinceHolding(s, 1)).toMatchObject({ owner: 1, everSettled: true });
    expect(provinceHolding(s, 2)).toMatchObject({ owner: 0, seat: -1, everSettled: false, claimPercent: 0 });
  });

  it('reports claim progress as a percentage of the forty-five seconds rule III gives', () => {
    const s = sim({ villagerCols: [8] });
    s.run(120);
    const holding = provinceHolding(s, 2)!;
    expect(holding.claimant).toBe(1);
    expect(holding.claimPercent).toBeGreaterThan(0);
    expect(holding.claimPercent).toBeLessThan(100);
  });
});

describe('buildOptions', () => {
  it('offers everything but the seat — a seat is planted by colonising', () => {
    const kinds = buildOptions(sim(), 1, -1).map((o) => o.kind);
    expect(kinds).toEqual([...BUILDABLE]);
    expect(kinds).not.toContain(BuildingKind.Seat);
  });

  it('lets the terrain decide, which is rule IV feeding rule II', () => {
    const s = sim();
    const onPlains = buildOptions(s, 1, cellAt(5));
    const onForest = buildOptions(s, 1, cellAt(FOREST_COL));
    const onHighland = buildOptions(s, 1, cellAt(HIGHLAND_COL));
    const allowed = (options: ReturnType<typeof buildOptions>, kind: number) =>
      options.find((o) => o.kind === kind)!.allowedHere;

    expect(allowed(onPlains, BuildingKind.Farm)).toBe(true);
    expect(allowed(onForest, BuildingKind.Farm)).toBe(false);
    expect(allowed(onForest, BuildingKind.LumberCamp)).toBe(true);
    expect(allowed(onHighland, BuildingKind.Mine)).toBe(true);
    expect(allowed(onPlains, BuildingKind.Mine)).toBe(false);
  });

  it('always says why, so a greyed button is never a mystery', () => {
    const s = sim({ timber: 0, silver: 0 });
    for (const option of buildOptions(s, 1, cellAt(5))) {
      if (option.affordable && option.allowedHere) continue;
      expect(option.reason).not.toBe('');
    }
    const blocked = buildOptions(s, 1, cellAt(FOREST_COL)).find((o) => o.kind === BuildingKind.Farm)!;
    expect(blocked.reason).toMatch(/plains/);
  });

  it('refuses a cell something already stands on', () => {
    const s = sim();
    const seat = buildOptions(s, 1, cellAt(1));
    expect(seat.every((o) => !o.allowedHere)).toBe(true);
    expect(seat[0].reason).toMatch(/already stands/);
  });
});

describe('trainOptions', () => {
  it('offers what the seat trains, at what it costs', () => {
    const s = sim();
    const options = trainOptions(s, s.buildings.get(1)!);
    expect(options.map((o) => o.kind)).toEqual([UnitKind.Villager, UnitKind.Scout]);
    expect(options[0].affordable).toBe(true);
  });

  it('marks a unit population-blocked rather than unaffordable — a house, not a refusal', () => {
    const s = sim();
    const player = s.players.get(1)!;
    s.run(2);
    player.pop = player.popCap;
    const villager = trainOptions(s, s.buildings.get(1)!)[0];
    expect(villager.affordable).toBe(true);
    expect(villager.popBlocked).toBe(true);
  });

  it('is empty for a building that trains nothing', () => {
    const s = sim();
    const farm = s.buildings.place({ owner: 1, kind: BuildingKind.Farm, cell: cellAt(4), complete: true });
    expect(trainOptions(s, farm)).toEqual([]);
  });
});

describe('coloniseView', () => {
  it('is ready for a villager standing on unsettled ground with the food to pay', () => {
    const s = sim({ villagerCols: [8] });
    const view = coloniseView(s, 1);
    expect(view).toMatchObject({ provinceIndex: 2, ready: true, reason: '' });
    expect(view.price).toBeGreaterThan(0);
  });

  it('refuses at home, and says the province is already yours', () => {
    expect(coloniseView(sim({ villagerCols: [1] }), 1)).toMatchObject({ ready: false, reason: 'Already yours.' });
  });

  it('refuses without the food, naming the price', () => {
    const s = sim({ villagerCols: [8], food: 0 });
    const view = coloniseView(s, 1);
    expect(view.ready).toBe(false);
    expect(view.reason).toMatch(new RegExp(`${view.price} food`));
  });

  it('refuses razed ground, because rule III claims it rather than selling it', () => {
    const s = sim({ villagerCols: [8] });
    s.provinces.get(2)!.everSettled = true;
    expect(coloniseView(s, 1)).toMatchObject({ ready: false, reason: expect.stringMatching(/claimed, not bought/) });
  });

  it('refuses a unit that is not a villager', () => {
    const s = new Sim({
      seed: 1,
      terrain: testGrid(),
      scenario: {
        players: [{ index: 1, food: 500, timber: 0, silver: 0 }],
        buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: cellAt(1) }],
        units: [{ owner: 1, kind: UnitKind.Scout, x: cellCentre(8), y: cellCentre(ROW), speed: 1 }],
      },
    });
    expect(coloniseView(s, 1)).toMatchObject({ ready: false, reason: 'Only a villager plants a seat.' });
  });

  it('never says ready for an order the simulation would drop', () => {
    // The exhaustive version of the point: whenever the view says ready, the command
    // actually lands; whenever it says no, nothing is spent.
    for (const [cols, food] of [
      [[8], 500],
      [[8], 0],
      [[1], 500],
    ] as const) {
      const s = sim({ villagerCols: [...cols], food });
      const view = coloniseView(s, 1);
      const before = s.buildings.all().length;
      s.issue({ type: 'colonise', unit: 1, province: view.provinceIndex });
      s.run(3);
      expect(s.buildings.all().length).toBe(before + (view.ready ? 1 : 0));
    }
  });
});

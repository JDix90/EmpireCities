import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from './sim';
import { TerrainGrid, Biome, packCell } from './terrain';
import {
  BUILDING_SPECS,
  BuildingKind,
  STARVATION_INTERVAL_TICKS,
  TICKS_PER_MINUTE,
  UNIT_SPECS,
  UnitKind,
  seconds,
} from './rules';

/**
 * A 10x3 strip: row 1 is plains except one forest cell and one highland cell, so every
 * building kind has somewhere legal and somewhere illegal to stand.
 *
 *   col:  0 1 2 3 4 5 6 7 8 9
 *   row1: . . . . F . H . . .      (. plains, F forest, H highland)
 */
const WIDTH = 10;
const FOREST_COL = 4;
const HIGHLAND_COL = 6;

function testGrid(): TerrainGrid {
  const height = 3;
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * height).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    let biome: number = Biome.Plains;
    if (c === FOREST_COL) biome = Biome.Forest;
    else if (c === HIGHLAND_COL) biome = Biome.Highland;
    // Woodland is a flag beside the biome now, not a biome value, so a forest cell has to
    // carry it or no lumber camp will stand there. See WOODED_BIT in terrain.ts.
    cells[1 * WIDTH + c] = packCell({
      owner: 1,
      tier: 0,
      passable: true,
      biome: biome as 2 | 3 | 4,
      wooded: c === FOREST_COL,
    });
  }
  return new TerrainGrid(WIDTH, height, cells, {
    provinces: [{ index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' }],
  });
}

const cellAt = (col: number) => 1 * WIDTH + col;

/** A seat at column 0, one player, and `villagers` villagers standing on a given column. */
function economySim(options: { villagers?: number; villagerCol?: number; food?: number; timber?: number } = {}) {
  const grid = testGrid();
  const villagers = options.villagers ?? 1;
  const col = options.villagerCol ?? 0;
  return new Sim({
    seed: 1,
    terrain: grid,
    scenario: {
      players: [{ index: 1, food: options.food ?? 200, timber: options.timber ?? 100, silver: 0 }],
      buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: cellAt(0) }],
      units: Array.from({ length: villagers }, () => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(col),
        y: cellCentre(1),
        speed: 1 << 14,
      })),
    },
  });
}

/** Places a completed building directly, skipping construction. */
function placeComplete(sim: Sim, kind: number, col: number) {
  return sim.buildings.place({ kind: kind as 1 | 2 | 3 | 4 | 5, owner: 1, cell: cellAt(col), complete: true });
}

describe('the economy is opt-in', () => {
  it('a scenario with no seats runs with no economy at all', () => {
    const sim = new Sim({ seed: 1, scenario: { units: [{ owner: 1, x: 0, y: 0, speed: 0 }] } });
    expect(sim.hasEconomy).toBe(false);
    sim.run(10);
    expect(sim.players.size).toBe(0);
  });

  it('refuses an economy scenario with no terrain, rather than placing buildings nowhere', () => {
    expect(
      () =>
        new Sim({
          seed: 1,
          scenario: { units: [], players: [{ index: 1 }], buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: 0 }] },
        }),
    ).toThrow(/needs terrain/);
  });

  it('refuses a building for a seat that does not exist', () => {
    expect(
      () =>
        new Sim({
          seed: 1,
          terrain: testGrid(),
          scenario: { units: [], players: [{ index: 1 }], buildings: [{ owner: 9, kind: BuildingKind.Seat, cell: 0 }] },
        }),
    ).toThrow(/unknown seat/);
  });
});

describe('gathering', () => {
  it("delivers the brief's exact numbers: a farmer is 12 food a minute, 9 net of their own meal", () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    const before = sim.players.get(1)!.food;

    sim.run(TICKS_PER_MINUTE + 2); // +2 for the command delay

    const player = sim.players.get(1)!;
    // 12 gathered, 3 eaten. Exactly, with no rounding drift — that is the whole reason
    // rates accumulate per minute instead of dividing into per-tick fractions.
    expect(player.food - before).toBe(9);
  });

  it('scales exactly with the number of workers present', () => {
    const sim = economySim({ villagers: 3, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    for (const id of [1, 2, 3]) sim.issue({ type: 'assign', unit: id, building: farm.id });
    const before = sim.players.get(1)!.food;
    sim.run(TICKS_PER_MINUTE + 2);
    // 3 farmers: 36 gathered, 9 eaten.
    expect(sim.players.get(1)!.food - before).toBe(27);
  });

  it('pays nothing for a worker who has not arrived yet', () => {
    // Assigned to a farm nine cells away at a quarter-cell a tick: 36 ticks of walking.
    const sim = economySim({ villagers: 1, villagerCol: 0 });
    const farm = placeComplete(sim, BuildingKind.Farm, 9);
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    const before = sim.players.get(1)!.food;
    sim.run(20);
    expect(sim.entities.get(1)!.moving).toBe(true); // still walking there
    // Walking costs real time, which is what makes WHERE a building goes a decision.
    expect(sim.players.get(1)!.foodAcc ?? 0).toBe(0);
    expect(sim.players.get(1)!.food).toBeLessThanOrEqual(before);
  });

  it('pays nothing from a building that is still a construction site', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = sim.buildings.place({ kind: BuildingKind.Farm, owner: 1, cell: cellAt(2) });
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    const before = sim.players.get(1)!.food;
    // Stop short of completion: the villager has been building, not farming.
    sim.run(BUILDING_SPECS[BuildingKind.Farm].buildTicks - 10);
    expect(farm.complete).toBe(false);
    // Nothing has been earned: the accumulator is the honest measure here, because at
    // this point the villager has not yet eaten a whole unit of food either.
    expect(sim.players.get(1)!.foodAcc).toBe(0);
    expect(sim.players.get(1)!.food).toBeLessThanOrEqual(before);
  });

  it('keeps the builder on as the farmer once the farm is finished', () => {
    // Assignment is to the BUILDING, not to a task: whoever raised the farm works it.
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = sim.buildings.place({ kind: BuildingKind.Farm, owner: 1, cell: cellAt(2) });
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    sim.run(BUILDING_SPECS[BuildingKind.Farm].buildTicks + 5);
    expect(farm.complete).toBe(true);
    expect(farm.workers).toEqual([1]);
    const before = sim.players.get(1)!.food;
    sim.run(TICKS_PER_MINUTE);
    expect(sim.players.get(1)!.food - before).toBe(9);
  });

  it('releases the builders of something nobody can work, rather than parking them there', () => {
    const sim = economySim({ villagers: 1, villagerCol: 3, timber: 500 });
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.House, cell: cellAt(3) });
    sim.run(3 + BUILDING_SPECS[BuildingKind.House].buildTicks + 5);
    const house = sim.buildings.atCell(cellAt(3))!;
    expect(house.complete).toBe(true);
    expect(house.workers).toEqual([]);
    expect(sim.entities.get(1)!.job).toBe(-1);
  });

  it('routes each building kind to its own resource', () => {
    const sim = economySim({ villagers: 2, villagerCol: FOREST_COL });
    const camp = placeComplete(sim, BuildingKind.LumberCamp, FOREST_COL);
    sim.issue({ type: 'assign', unit: 1, building: camp.id });
    const p = sim.players.get(1)!;
    const timberBefore = p.timber;
    sim.run(TICKS_PER_MINUTE + 2);
    expect(p.timber - timberBefore).toBe(8);
  });
});

describe('upkeep and starvation', () => {
  it('eats 3 food a minute per villager', () => {
    const sim = economySim({ villagers: 2, food: 100 });
    sim.run(TICKS_PER_MINUTE);
    expect(sim.players.get(1)!.food).toBe(94);
    expect(sim.players.get(1)!.starving).toBe(false);
  });

  it('starves when the food runs out, and bleeds units on the attrition cadence', () => {
    const sim = economySim({ villagers: 1, food: 0 });
    const unit = sim.entities.get(1)!;
    const fullHp = unit.hp;
    sim.run(STARVATION_INTERVAL_TICKS + 2);
    expect(sim.players.get(1)!.starving).toBe(true);
    expect(unit.hp).toBeLessThan(fullHp);
  });

  it('kills a unit that starves long enough, and forgets it cleanly', () => {
    // Employed at a lumber camp: it earns timber, so nothing refills the food it eats.
    const sim = economySim({ villagers: 1, villagerCol: FOREST_COL, food: 0 });
    const camp = placeComplete(sim, BuildingKind.LumberCamp, FOREST_COL);
    sim.issue({ type: 'assign', unit: 1, building: camp.id });
    sim.run(3);
    expect(camp.workers).toEqual([1]);
    // 40 hp, 1% of 40 rounds down to 0 so the minimum bite of 1 applies: 40 intervals.
    sim.run(STARVATION_INTERVAL_TICKS * 41);
    expect(sim.entities.get(1)).toBeUndefined();
    // Nothing points at a corpse: the camp's worker list is clean.
    expect(camp.workers).toEqual([]);
    expect(sim.players.get(1)!.pop).toBe(0);
  });

  it('stops starving the moment food arrives', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2, food: 0 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    sim.run(TICKS_PER_MINUTE + 2);
    expect(sim.players.get(1)!.food).toBeGreaterThan(0);
    expect(sim.players.get(1)!.starving).toBe(false);
  });
});

describe('construction', () => {
  it('builds where the terrain allows it and refuses where it does not', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    // A farm needs plains. Column 4 is forest.
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(FOREST_COL) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(FOREST_COL))).toBeUndefined();

    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(2) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(2))?.kind).toBe(BuildingKind.Farm);
  });

  it('lets a lumber camp stand on wooded ground and a mine in hills', () => {
    const sim = economySim({ villagers: 1, villagerCol: FOREST_COL, timber: 500 });
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.LumberCamp, cell: cellAt(FOREST_COL) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(FOREST_COL))?.kind).toBe(BuildingKind.LumberCamp);
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Mine, cell: cellAt(HIGHLAND_COL) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(HIGHLAND_COL))?.kind).toBe(BuildingKind.Mine);
  });

  it('refuses a lumber camp on ground the forest mask never covered', () => {
    // The rule is the wooded FLAG, not the forest biome — that is what lets a wooded hill
    // hold a camp while staying highland for movement and the archer's high ground. The
    // two came apart on the committed map, where the composer was erasing every upland
    // wood and leaving two seats with no timber anywhere.
    const sim = economySim({ villagers: 1, villagerCol: 2, timber: 500 });
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.LumberCamp, cell: cellAt(2) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(2))).toBeUndefined();
    expect(sim.players.get(1)!.timber).toBe(500);
  });

  it('charges timber, and refuses when it cannot be paid', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2, timber: 10 });
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(2) });
    sim.run(3);
    expect(sim.buildings.atCell(cellAt(2))).toBeUndefined();
    expect(sim.players.get(1)!.timber).toBe(10);
  });

  it('two builders halve the time, exactly as the brief says', () => {
    const spec = BUILDING_SPECS[BuildingKind.Farm];

    /** Ticks from the order landing to the building being finished. */
    function ticksToBuild(builders: number): number {
      const sim = economySim({ villagers: builders, villagerCol: 2, timber: 500 });
      sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(2) });
      sim.run(3);
      const site = sim.buildings.atCell(cellAt(2))!;
      for (let id = 2; id <= builders; id++) sim.issue({ type: 'assign', unit: id, building: site.id });
      sim.run(2);
      const start = sim.tick;
      for (let i = 0; i < spec.buildTicks * 2 && !site.complete; i++) sim.run(1);
      expect(site.complete).toBe(true);
      return sim.tick - start;
    }

    const one = ticksToBuild(1);
    const two = ticksToBuild(2);
    // Progress is builder-ticks, so two builders finish in half the time, give or take
    // the tick the second one was assigned on.
    expect(one).toBeGreaterThan(spec.buildTicks - 10);
    expect(two).toBeLessThanOrEqual(Math.ceil(one / 2) + 2);
    expect(two).toBeGreaterThan(Math.floor(one / 2) - 4);
  });

  it('a half-built building is half as tough, and refuses to share a cell', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2, timber: 500 });
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(2) });
    sim.run(3 + Math.floor(BUILDING_SPECS[BuildingKind.Farm].buildTicks / 2));
    const site = sim.buildings.atCell(cellAt(2))!;
    expect(site.hp).toBeGreaterThan(1);
    expect(site.hp).toBeLessThan(site.maxHp);
    // A second building cannot be stacked on the same cell.
    sim.issue({ type: 'build', unit: 1, kind: BuildingKind.Farm, cell: cellAt(2) });
    sim.run(3);
    expect(sim.buildings.all().filter((b) => b.cell === cellAt(2))).toHaveLength(1);
  });
});

describe('training', () => {
  it('charges on order and delivers the unit after the training time', () => {
    const sim = economySim({ villagers: 1 });
    const seat = sim.buildings.atCell(cellAt(0))!;
    const before = sim.players.get(1)!.food;
    sim.issue({ type: 'train', building: seat.id, unit: UnitKind.Villager });
    sim.run(3);
    expect(sim.players.get(1)!.food).toBe(before - UNIT_SPECS[UnitKind.Villager].food);
    expect(sim.entities.size).toBe(1);
    sim.run(UNIT_SPECS[UnitKind.Villager].trainTicks);
    expect(sim.entities.size).toBe(2);
    expect(sim.entities.get(2)!.kind).toBe(UnitKind.Villager);
  });

  it('refuses an order it cannot pay for', () => {
    const sim = economySim({ villagers: 1, food: 10 });
    const seat = sim.buildings.atCell(cellAt(0))!;
    sim.issue({ type: 'train', building: seat.id, unit: UnitKind.Villager });
    sim.run(3);
    expect(seat.queue).toEqual([]);
    expect(sim.players.get(1)!.food).toBe(10);
  });

  it('refuses a unit the building does not train', () => {
    const sim = economySim({ villagers: 1, food: 1000 });
    const seat = sim.buildings.atCell(cellAt(0))!;
    sim.issue({ type: 'train', building: seat.id, unit: UnitKind.Cavalry });
    sim.run(3);
    expect(seat.queue).toEqual([]);
    expect(sim.players.get(1)!.food).toBe(1000);
  });

  it('holds a finished unit at the gate when the population is full', () => {
    // The seat gives 10 population; fill it with ten villagers.
    const sim = economySim({ villagers: 10, food: 1000 });
    const seat = sim.buildings.atCell(cellAt(0))!;
    sim.run(2);
    expect(sim.players.get(1)!.pop).toBe(10);
    expect(sim.players.get(1)!.popCap).toBe(10);
    sim.issue({ type: 'train', building: seat.id, unit: UnitKind.Villager });
    sim.run(UNIT_SPECS[UnitKind.Villager].trainTicks + 10);
    // Trained but homeless: it waits rather than being lost or breaking the cap.
    expect(sim.entities.size).toBe(10);
    expect(seat.queue).toEqual([UnitKind.Villager]);
  });

  it('a house raises the cap and releases the waiting unit', () => {
    const sim = economySim({ villagers: 10, food: 1000 });
    const seat = sim.buildings.atCell(cellAt(0))!;
    sim.issue({ type: 'train', building: seat.id, unit: UnitKind.Villager });
    sim.run(UNIT_SPECS[UnitKind.Villager].trainTicks + 10);
    expect(sim.entities.size).toBe(10);
    placeComplete(sim, BuildingKind.House, 3);
    sim.run(2);
    expect(sim.players.get(1)!.popCap).toBe(15);
    expect(sim.entities.size).toBe(11);
  });
});

describe('assignment', () => {
  it('moves a villager between jobs, never onto two at once', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    const camp = placeComplete(sim, BuildingKind.LumberCamp, FOREST_COL);
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    sim.run(3);
    expect(farm.workers).toEqual([1]);
    sim.issue({ type: 'assign', unit: 1, building: camp.id });
    sim.run(3);
    expect(farm.workers).toEqual([]);
    expect(camp.workers).toEqual([1]);
    expect(sim.entities.get(1)!.job).toBe(camp.id);
  });

  it('unassigns on -1, which is the only way off a job', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    sim.issue({ type: 'assign', unit: 1, building: farm.id });
    sim.run(3);
    sim.issue({ type: 'assign', unit: 1, building: -1 });
    sim.run(3);
    expect(farm.workers).toEqual([]);
    expect(sim.entities.get(1)!.job).toBe(-1);
  });

  it('refuses a job beyond the building\'s slots', () => {
    const sim = economySim({ villagers: 6, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    for (const id of [1, 2, 3, 4, 5, 6]) sim.issue({ type: 'assign', unit: id, building: farm.id });
    sim.run(3);
    expect(farm.workers).toHaveLength(BUILDING_SPECS[BuildingKind.Farm].workerSlots);
  });

  it('keeps the worker list in id order whatever order the orders arrived in', () => {
    const sim = economySim({ villagers: 3, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    for (const id of [3, 1, 2]) sim.issue({ type: 'assign', unit: id, building: farm.id });
    sim.run(3);
    // The list is hashed, so its order must not depend on arrival order.
    expect(farm.workers).toEqual([1, 2, 3]);
  });

  it('refuses to put a soldier on a farm', () => {
    const sim = economySim({ villagers: 1, villagerCol: 2 });
    const farm = placeComplete(sim, BuildingKind.Farm, 2);
    const scout = sim.entities.spawn({ owner: 1, kind: UnitKind.Scout, x: cellCentre(2), y: cellCentre(1), speed: 1 });
    sim.issue({ type: 'assign', unit: scout.id, building: farm.id });
    sim.run(3);
    expect(farm.workers).toEqual([]);
  });
});

describe('determinism', () => {
  it('an economy match replays to the same hash', () => {
    const build = () => {
      const sim = economySim({ villagers: 3, villagerCol: 2, timber: 500 });
      return sim;
    };
    const live = build();
    const seat = live.buildings.atCell(cellAt(0))!;
    const farm = live.buildings.place({ kind: BuildingKind.Farm, owner: 1, cell: cellAt(2), complete: true });
    live.issue({ type: 'assign', unit: 1, building: farm.id });
    live.issue({ type: 'assign', unit: 2, building: farm.id });
    live.issue({ type: 'train', building: seat.id, unit: UnitKind.Villager });
    live.run(seconds(40));
    live.issue({ type: 'build', unit: 3, kind: BuildingKind.LumberCamp, cell: cellAt(FOREST_COL) });
    live.run(seconds(60));

    // Rebuilt from scratch, the same commands, the same buildings placed the same way.
    const replayed = build();
    replayed.buildings.place({ kind: BuildingKind.Farm, owner: 1, cell: cellAt(2), complete: true });
    for (const entry of live.toReplay().commands) replayed.scheduleAt(entry.command, entry.tick);
    replayed.runTo(live.tick);
    expect(replayed.hash()).toBe(live.hash());
  });

  it('refuses a replay recorded before the economy existed', () => {
    const sim = economySim();
    const replay = { ...sim.toReplay(), version: 1 };
    expect(() => Sim.fromReplay(replay)).toThrow(/unsupported replay version 1/);
  });
});

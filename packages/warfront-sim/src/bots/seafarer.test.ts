import { describe, it, expect } from 'vitest';
import { Sim, cellCentre } from '../sim';
import { TerrainGrid, Biome, packCell } from '../terrain';
import { BotDriver } from '../botDriver';
import { buildProvinceGeography } from '../tribes';
import { IslanderBot, MarinerBot, SeafarerBot } from './seafarer';
import { BuildingKind, TICKS_PER_MINUTE, UnitKind } from '../rules';
import { isCoastal } from '../coast';

/**
 * The two policies that could not exist before rule V.
 *
 * The map is built so the two must visibly DISAGREE: a near mainland and a far island,
 * both unsettled and both one lane away. A Mariner takes the nearest thing and an Islander
 * takes the island, so a test that only offered one target would pass for either policy
 * and prove neither.
 *
 *   cols  0-9    province 1, home, with the seat and the port
 *   cols 14-17   province 3, "mainland" — it has a land neighbour, so it is not an island
 *   cols 18-21   province 4, province 3's land neighbour, no lane of its own
 *   cols 30-39   province 2, a true island: no land neighbours at all
 */
const WIDTH = 40;
const HEIGHT = 30;
const HOME_LAST_COL = 9;
const MAINLAND_COLS: [number, number] = [14, 17];
const INLAND_COLS: [number, number] = [18, 21];
const ISLAND_FIRST_COL = 30;

function provinceOf(col: number): number {
  if (col <= HOME_LAST_COL) return 1;
  if (col >= MAINLAND_COLS[0] && col <= MAINLAND_COLS[1]) return 3;
  if (col >= INLAND_COLS[0] && col <= INLAND_COLS[1]) return 4;
  if (col >= ISLAND_FIRST_COL) return 2;
  return 0;
}

function seaGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * HEIGHT).fill(sea);
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      const province = provinceOf(col);
      if (province === 0) continue;
      // Plains everywhere but one forest column at home, so the build order can reach its
      // lumber camp and get to the port rather than stalling on ground that is not there.
      const wooded = col === 3;
      const biome = wooded ? Biome.Forest : Biome.Plains;
      // Wooded as well as forest-biomed: the lumber camp is sited by the flag now, and the
      // real asset never carries one without the other.
      cells[row * WIDTH + col] = packCell({ owner: province, tier: 0, passable: true, biome, wooded });
    }
  }
  return new TerrainGrid(WIDTH, HEIGHT, cells, {
    provinces: [
      { index: 1, territory_id: 'home', name: 'Home' },
      { index: 2, territory_id: 'island', name: 'Island' },
      { index: 3, territory_id: 'mainland', name: 'Mainland' },
      { index: 4, territory_id: 'inland', name: 'Inland' },
    ],
    // Home reaches both the near mainland and the far island. Nothing reaches the inland
    // province, which exists only to give the mainland a land neighbour.
    lanes: [
      { from: 'home', to: 'island' },
      { from: 'home', to: 'mainland' },
    ],
  });
}

const at = (col: number, row: number) => row * WIDTH + col;

/** One seat at home with a finished port, three villagers, and stores to spend. */
function voyage(bot: SeafarerBot, minutes: number) {
  const terrain = seaGrid();
  const sim = new Sim({
    seed: 11,
    terrain,
    scenario: {
      players: [{ index: 1, food: 5000, timber: 500, silver: 500 }],
      buildings: [
        { owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) },
        { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 15) },
      ],
      units: [0, 1, 2].map((i) => ({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(4 + i),
        y: cellCentre(15),
        speed: Math.round((54 * 65536) / (15 * 60)),
      })),
    },
  });
  const driver = new BotDriver(11, new Map([[1, bot]]), buildProvinceGeography(terrain));
  const cap = TICKS_PER_MINUTE * minutes;
  while (sim.tick < cap) {
    driver.beforeTick(sim, sim.tick + 1);
    sim.step();
  }
  return sim;
}

describe('the map this file argues over', () => {
  it('offers one island and one mainland, both a lane away and both unsettled', () => {
    const grid = seaGrid();
    const geography = buildProvinceGeography(grid);
    // The island has no land neighbours; the mainland has one. That is the whole
    // difference the Islander reads, and it comes from the map rather than a name.
    expect(geography.neighbours.get(2) ?? []).toHaveLength(0);
    expect((geography.neighbours.get(3) ?? []).length).toBeGreaterThan(0);
  });
});

describe('MarinerBot (rule V)', () => {
  it('puts a port in its build order — "ports first"', () => {
    expect(new MarinerBot()['buildOrder']()).toContain(BuildingKind.Port);
  });

  it('ships a villager across a lane and colonises what it lands on', () => {
    const sim = voyage(new MarinerBot(), 6);
    const held = sim.provinces.all().filter((p) => p.owner === 1);
    expect(held.length).toBeGreaterThan(1);
    // It took the NEAR one: the mainland is fourteen columns out, the island thirty.
    expect(held.map((p) => p.index)).toContain(3);
  });

  it('issues a real embark, so the crossing went by sea rather than round the map', () => {
    const sim = voyage(new MarinerBot(), 6);
    const embarks = sim.toReplay().commands.filter((c) => c.command.type === 'embark');
    expect(embarks.length).toBeGreaterThan(0);
  });

  it('never has two colonists at sea at once', () => {
    // Rule I's price rises per province held, so two in flight means paying the first
    // price twice and stranding whoever lands second.
    const terrain = seaGrid();
    const sim = new Sim({
      seed: 11,
      terrain,
      scenario: {
        players: [{ index: 1, food: 5000, timber: 500, silver: 500 }],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) },
          { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 15) },
        ],
        units: [0, 1, 2, 3, 4].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(4 + i),
          y: cellCentre(15),
          speed: Math.round((54 * 65536) / (15 * 60)),
        })),
      },
    });
    const driver = new BotDriver(11, new Map([[1, new MarinerBot()]]), buildProvinceGeography(terrain));
    let most = 0;
    while (sim.tick < TICKS_PER_MINUTE * 8) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
      most = Math.max(most, sim.convoys.all().length);
    }
    expect(most).toBeLessThanOrEqual(1);
  });
});

describe('a policy that has to raise its own harbour', () => {
  /** The same opening with no port, so the build order has to produce one. */
  function fromScratch(bot: SeafarerBot, minutes: number) {
    const terrain = seaGrid();
    const sim = new Sim({
      seed: 11,
      terrain,
      scenario: {
        players: [{ index: 1, food: 5000, timber: 500, silver: 500 }],
        buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) }],
        units: [0, 1, 2, 3].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(4 + i),
          y: cellCentre(15),
          speed: Math.round((54 * 65536) / (15 * 60)),
        })),
      },
    });
    const driver = new BotDriver(11, new Map([[1, bot]]), buildProvinceGeography(terrain));
    while (sim.tick < TICKS_PER_MINUTE * minutes) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
    }
    return sim;
  }

  it('sites the port on a coast, and asks for it once rather than forever', () => {
    const sim = fromScratch(new MarinerBot(), 6);
    const asks = sim
      .toReplay()
      .commands.filter((c) => c.command.type === 'build' && (c.command as { kind: number }).kind === BuildingKind.Port);
    expect(asks.length).toBeGreaterThan(0);

    // The count is the point. The simulation refuses a port that is not on a coast and
    // says nothing about it, so a policy proposing the first passable cell it finds gets
    // refused and proposes the same cell a second later, for the whole match. Measured
    // before the bot knew a port's ground rule: FOURTEEN THOUSAND refused build commands
    // across twelve matches, three convoys, and a build order stuck behind a harbour it
    // could not raise. Nothing else in the suite would have noticed — a refused command
    // is dropped silently rather than throwing.
    expect(asks.length).toBeLessThan(5);

    const port = sim.buildings.all().find((b) => b.kind === BuildingKind.Port);
    expect(port).toBeDefined();
    expect(isCoastal(sim.terrain!, port!.cell)).toBe(true);
  });
});

describe('IslanderBot (rule V)', () => {
  it('takes the island over the nearer mainland', () => {
    const sim = voyage(new IslanderBot(), 8);
    const held = sim.provinces.all().filter((p) => p.owner === 1).map((p) => p.index);
    expect(held).toContain(2);
  });

  it('falls back to the nearest when no island is left, rather than stalling in port', () => {
    // The island already belongs to somebody, so the Islander's preference has nothing to
    // aim at. It should still sail — a policy that sat in port once Britannia was taken
    // would stop being a policy.
    //
    // Tested through a real match rather than a hand-built view: the first version of this
    // test stubbed a BotView, and when the fallback grew to need the seat's port the stub
    // silently lacked one. A fake that has to be extended every time the code reads one
    // more field is a fake that stops testing the code.
    const terrain = seaGrid();
    const sim = new Sim({
      seed: 11,
      terrain,
      scenario: {
        players: [
          { index: 1, food: 5000, timber: 500, silver: 500 },
          { index: 2, food: 5000, timber: 500, silver: 500 },
        ],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) },
          { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 15) },
          // Seat 2 already holds the island.
          { owner: 2, kind: BuildingKind.Seat, cell: at(ISLAND_FIRST_COL + 5, 15) },
        ],
        units: [0, 1, 2].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(4 + i),
          y: cellCentre(15),
          speed: Math.round((54 * 65536) / (15 * 60)),
        })),
      },
    });
    const driver = new BotDriver(11, new Map([[1, new IslanderBot()]]), buildProvinceGeography(terrain));
    while (sim.tick < TICKS_PER_MINUTE * 8) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
    }
    const held = sim.provinces.all().filter((p) => p.owner === 1).map((p) => p.index);
    expect(held).toContain(3);
    expect(held).not.toContain(2);
  });
});

describe('a voyage is not launched on credit', () => {
  it('waits until the colonisation price is actually in hand', () => {
    // A colonist that sails without the price is a villager parked on a beach for the
    // rest of the match: it cannot settle when it lands, and it is no longer working.
    const terrain = seaGrid();
    const sim = new Sim({
      seed: 11,
      terrain,
      scenario: {
        // Below rule I's first price, and no farm to earn it back quickly.
        players: [{ index: 1, food: 30, timber: 500, silver: 500 }],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) },
          { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 15) },
        ],
        units: [0, 1, 2].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(4 + i),
          y: cellCentre(15),
          speed: Math.round((54 * 65536) / (15 * 60)),
        })),
      },
    });
    const bot = new MarinerBot();
    const driver = new BotDriver(11, new Map([[1, bot]]), buildProvinceGeography(terrain));
    // Two minutes is not long enough to earn 112 food from a standing start with no farm.
    while (sim.tick < TICKS_PER_MINUTE * 2) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
      expect(sim.players.get(1)!.food).toBeLessThan(sim.colonisePriceFor(1));
      expect(bot.isSailing).toBe(false);
    }
    expect(sim.toReplay().commands.filter((c) => c.command.type === 'embark')).toHaveLength(0);
  });
});

describe('the two policies disagree', () => {
  /** The province a seat takes FIRST, which is where the two policies differ. */
  function firstTaken(bot: SeafarerBot): number {
    const terrain = seaGrid();
    const sim = new Sim({
      seed: 11,
      terrain,
      scenario: {
        players: [{ index: 1, food: 5000, timber: 500, silver: 500 }],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat, cell: at(2, 15) },
          { owner: 1, kind: BuildingKind.Port, cell: at(HOME_LAST_COL, 15) },
        ],
        units: [0, 1, 2].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(4 + i),
          y: cellCentre(15),
          speed: Math.round((54 * 65536) / (15 * 60)),
        })),
      },
    });
    const driver = new BotDriver(11, new Map([[1, bot]]), buildProvinceGeography(terrain));
    while (sim.tick < TICKS_PER_MINUTE * 10) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
      const taken = sim.provinces.all().find((p) => p.owner === 1 && p.index !== 1);
      if (taken) return taken.index;
    }
    return -1;
  }

  it('reaches for different provinces first', () => {
    // Compared on the FIRST acquisition, not the final holding: given ten minutes both
    // policies eventually take everything on a four-province map, and comparing the end
    // state showed them identical while they were in fact playing quite differently.
    const mariner = firstTaken(new MarinerBot());
    const islander = firstTaken(new IslanderBot());
    expect(mariner).toBe(3); // the near mainland
    expect(islander).toBe(2); // the far island
    expect(mariner).not.toBe(islander);
  });
});

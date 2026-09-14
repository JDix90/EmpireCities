import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, Biome, packCell, type TerrainAsset } from '../terrain';
import { buildProvinceGeography } from '../tribes';
import { buildOpening } from '../openings';
import { runMatch } from '../match';
import { ColonistBot } from './colonist';
import { RaiderBot } from './raider';
import { TurtleBot } from './turtle';
import { RusherBot } from './rusher';
import {
  ATTRITION_INTERVAL_TICKS,
  BUILDING_SPECS,
  BuildingKind,
  COMBAT_SPECS,
  TICKS_PER_MINUTE,
  UnitKind,
  seconds,
  type BuildingKindValue,
} from '../rules';
import type { Bot } from '../bot';
import { Sim, cellCentre } from '../sim';
import { BotDriver } from '../botDriver';

/**
 * What makes each policy that policy.
 *
 * Every one is a variation on running an economy, so the tests are about the DELTA: what
 * this bot does that the baseline does not. A subclass that quietly lost its override
 * would otherwise pass every test the Colonist passes and be a fifth Colonist.
 */

const ASSET = join(__dirname, '..', '..', '..', '..', 'database/warfront/western_twenty.terrain.json');
const grid = TerrainGrid.decode(JSON.parse(readFileSync(ASSET, 'utf8')) as TerrainAsset);
const geography = buildProvinceGeography(grid);

/** Plays one seat against nobody, so the measurement is of that policy alone. */
function solo(bot: Bot, minutes: number, observe?: (sim: Sim) => void) {
  const { scenario } = buildOpening(grid, { seats: 2 });
  return runMatch({
    seed: 4242,
    scenario,
    terrain: grid,
    geography,
    bots: new Map([[2, bot]]),
    maxTicks: TICKS_PER_MINUTE * minutes,
    ...(observe ? { observe } : {}),
  });
}

/** The kinds this seat raised, in the order the sites appeared. */
function buildSequence(bot: Bot, minutes: number): number[] {
  const sequence: number[] = [];
  const seen = new Set<number>();
  solo(bot, minutes, (sim) => {
    for (const b of sim.buildings.all()) {
      if (b.owner !== 2 || seen.has(b.id)) continue;
      seen.add(b.id);
      if (b.kind !== BuildingKind.Seat) sequence.push(b.kind);
    }
  });
  return sequence;
}

function unitsOf(out: ReturnType<typeof solo>, kind: number): number {
  return out.replay.commands.filter((c) => c.command.type === 'train' && c.command.unit === kind).length;
}

describe('every policy names itself', () => {
  it('so the lab can attribute a win to a policy', () => {
    expect([new ColonistBot().name, new RaiderBot().name, new TurtleBot().name, new RusherBot().name]).toEqual([
      'colonist',
      'raider',
      'turtle',
      'rusher',
    ]);
  });
});

describe('Colonist — the baseline', () => {
  it('raises the timber source first, because nothing else makes timber', () => {
    expect(buildSequence(new ColonistBot(), 6)[0]).toBe(BuildingKind.LumberCamp);
  });

  it('buys no army beyond the garrison its parameters name', () => {
    const out = solo(new ColonistBot(), 8);
    expect(unitsOf(out, UnitKind.Skirmisher)).toBe(0);
    expect(unitsOf(out, UnitKind.Ram)).toBe(0);
  });

  it('pulls villagers off their jobs when raiders reach them', () => {
    // Rule VI's first raid lands around minute two; a villager that stands still dies,
    // because villagers cannot fight at all.
    const out = solo(new ColonistBot(), 8);
    const unassigns = out.replay.commands.filter((c) => c.command.type === 'assign' && c.command.building === -1);
    expect(unassigns.length).toBeGreaterThan(0);
  });
});

describe('Raider — early skirmishers', () => {
  it('puts the barracks second, ahead of its second farm', () => {
    const sequence = buildSequence(new RaiderBot(), 8);
    expect(sequence.slice(0, 2)).toEqual([BuildingKind.LumberCamp, BuildingKind.Barracks]);
  });

  it('buys skirmishers, which the baseline never does', () => {
    expect(unitsOf(solo(new RaiderBot(), 10), UnitKind.Skirmisher)).toBeGreaterThan(0);
    expect(unitsOf(solo(new ColonistBot(), 10), UnitKind.Skirmisher)).toBe(0);
  });
});

describe('Turtle — walls and towers, never past three provinces', () => {
  it('refuses to expand past its ceiling', () => {
    // The ceiling is a hard stop rather than a preference: the brief lists turtling as a
    // failure mode with an answer, and a Turtle that expanded would not be testing it.
    const bot = new TurtleBot({ ceiling: 1 });
    const out = solo(bot, 12);
    expect(out.replay.commands.filter((c) => c.command.type === 'colonise')).toHaveLength(0);
  });

  it('raises towers, which no other policy does', () => {
    const turtle = buildSequence(new TurtleBot(), 14);
    const colonist = buildSequence(new ColonistBot(), 14);
    expect(turtle).toContain(BuildingKind.Tower);
    expect(colonist).not.toContain(BuildingKind.Tower);
  });
});

describe('Rusher — attack the nearest seat at minute six', () => {
  it('waits for its attack minute, and marches once it arrives', () => {
    // The army requirement is set to nothing on purpose, so the CLOCK is the only thing
    // holding the march back — otherwise this would pass for a bot with no clock at all,
    // simply because it had not finished building its siege train yet.
    const early = new RusherBot({ attackMinute: 6, spears: 0, rams: 0 });
    solo(early, 4);
    expect(early.hasMarched).toBe(false);

    const due = new RusherBot({ attackMinute: 1, spears: 0, rams: 0 });
    solo(due, 4);
    expect(due.hasMarched).toBe(true);
  });

  it('builds a siege train rather than a garrison', () => {
    // Nothing but a ram reduces a seat in reasonable time, so a rush without one is a
    // walk. The spears are the escort that keeps the ram alive under the seat's tower.
    const out = solo(new RusherBot(), 14);
    expect(unitsOf(out, UnitKind.Spear)).toBeGreaterThan(0);
  });
});

/**
 * Rule VII's policy: the Rusher camps before it grinds.
 *
 * On its own grid, because the committed map cannot express this yet — the lab measures
 * first contact between seats as "never" at twenty-five minutes, so a Rusher playing the
 * western twenty marches for the whole match and arrives nowhere. A test of what the army
 * does ON ARRIVAL therefore has to start it there, exactly as the combat tests do.
 */
describe('the Rusher camps before it sieges (rule VII)', () => {
  const WIDTH = 40;
  const ROW = 1;
  const DEFENDER_SEAT = 0;
  const RUSHER_SEAT = 37;

  function stripGrid(): TerrainGrid {
    const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
    const cells = new Uint16Array(WIDTH * 3).fill(sea);
    for (let c = 0; c < WIDTH; c++) {
      cells[ROW * WIDTH + c] = packCell({
        owner: c < 20 ? 1 : 2,
        tier: 0,
        passable: true,
        biome: Biome.Plains,
      });
    }
    return new TerrainGrid(WIDTH, 3, cells, {
      provinces: [
        { index: 1, territory_id: 'defender', name: 'Defender' },
        { index: 2, territory_id: 'rusher', name: 'Rusher' },
      ],
    });
  }

  const at = (col: number) => ROW * WIDTH + col;

  /** Seat 2's band already standing in seat 1's province, eight cells clear of its tower. */
  function siege(armyCols: number[]) {
    const terrain = stripGrid();
    const sim = new Sim({
      seed: 7,
      terrain,
      scenario: {
        players: [
          { index: 1, food: 5000, timber: 500, silver: 500 },
          { index: 2, food: 5000, timber: 500, silver: 500 },
        ],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat, cell: at(DEFENDER_SEAT) },
          { owner: 2, kind: BuildingKind.Seat, cell: at(RUSHER_SEAT) },
          { owner: 2, kind: BuildingKind.Barracks, cell: at(RUSHER_SEAT - 1) },
        ],
        units: armyCols.map((col) => ({
          owner: 2,
          kind: UnitKind.Spear,
          x: cellCentre(col),
          y: cellCentre(ROW),
          speed: 0,
        })),
      },
    });
    // attackMinute 0 and a quota the band already meets, so the policy is past its clock
    // and its shopping list and the only thing left to decide is rule VII.
    const bot = new RusherBot({ attackMinute: 0, spears: armyCols.length, rams: 0 });
    const driver = new BotDriver(7, new Map([[2, bot]]), buildProvinceGeography(terrain));
    return { sim, driver };
  }

  function play(armyCols: number[], ticks: number) {
    const { sim, driver } = siege(armyCols);
    while (sim.tick < ticks) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
    }
    return sim;
  }

  it('plants one where the band is standing, on ground it does not hold', () => {
    const sim = play([8, 9, 10, 11, 12], seconds(6));
    const camps = sim.buildings.all().filter((b) => b.kind === BuildingKind.Camp);
    expect(camps).toHaveLength(1);
    expect(camps[0].owner).toBe(2);
    // Inside the defender's province, which is the only place the rule applies.
    expect(sim.terrain!.owner(camps[0].cell)).toBe(1);
  });

  it('raises it to completion and then stops bleeding', () => {
    const sim = play([8, 9, 10, 11, 12], BUILDING_SPECS[BuildingKind.Camp].buildTicks + seconds(8));
    const camp = sim.buildings.all().find((b) => b.kind === BuildingKind.Camp);
    expect(camp?.complete).toBe(true);

    // By id, not by index: the seat keeps training villagers underneath this, so the
    // entity list grows and comparing two snapshots positionally compares a spear to a
    // villager. The claim is about the band under the camp, so track the band.
    const band = sim.entities.all().filter((u) => u.kind === UnitKind.Spear);
    const before = new Map(band.map((u) => [u.id, u.hp]));
    expect(before.size).toBe(5);
    for (let i = 0; i < ATTRITION_INTERVAL_TICKS * 3; i++) sim.step();
    for (const [id, hp] of before) expect(sim.entities.get(id)?.hp).toBe(hp);
  });

  it('does not plant a second one over the first, or keep asking for it', () => {
    const sim = play([8, 9, 10, 11, 12], seconds(40));
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(1);

    // And asks exactly once. The count matters more than it looks: the SIM is what
    // refuses a second camp — on an occupied cell, and on too small a muster — so a bot
    // with no memory of its own camp would re-issue a doomed order every second for the
    // rest of the match and every test above would still pass. Nothing else in the suite
    // would notice, because a refused command is dropped silently rather than throwing.
    const asks = sim.toReplay().commands.filter((c) => c.command.type === 'camp');
    expect(asks).toHaveLength(1);
  });

  it('does not camp with fewer than the brief’s five', () => {
    // Held up by the simulation's muster check rather than the bot's — verified by
    // mutation, and worth writing down: the policy's own count is a courtesy that keeps
    // it from asking for something it knows will be refused, not the rule's enforcement.
    // The rule lives in `sim.ts`, where a hand-rolled command cannot get around it.
    const sim = play([8, 9, 10, 11], seconds(10));
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(0);
  });

  it('does not camp on its own ground', () => {
    // The same band, at home. Nothing is bleeding, so there is nothing to answer.
    const sim = play([25, 26, 27, 28, 29], seconds(10));
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Camp)).toHaveLength(0);
  });
});

/**
 * Rule V's policy: the Turtle lights its coast.
 *
 * On its own grid for the same reason the Rusher's camp test is — and for one more. The
 * committed map cannot pay for this: every policy in the roster stalls at seven
 * population somewhere around minute six with an unstaffed lumber camp, so a Turtle on the
 * western twenty spends its starting thirty silver on one tower and never sees twenty
 * again. That is a real defect and it predates this test (the Colonist does it too), but
 * it means a match on the real map cannot tell a policy that will not build a lighthouse
 * from one that cannot afford one. A seat that can afford it can.
 */
describe('the Turtle lights its coast (rule V)', () => {
  const COAST_WIDTH = 30;
  const COAST_HEIGHT = 12;
  const SHORE_LAST_COL = 9;
  const ISLE_FIRST_COL = 20;
  const SHORE = 1;
  const QUIET = 2;

  /**
   * Two provinces on a shore and an island across the water.
   *
   * `Shore` is the northern half and has the lane; `Quiet` is the southern half, just as
   * coastal and with no lane of its own. Which is the point: a light in Quiet is the only
   * way to tell a policy that watches its own province from one that watches a province
   * out, and the same shape is what makes `lanes: false` a fair test of "worth watching"
   * rather than a test of "is there a coast".
   */
  function coastGrid(withLanes: boolean): TerrainGrid {
    const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
    const cells = new Uint16Array(COAST_WIDTH * COAST_HEIGHT).fill(sea);
    for (let row = 0; row < COAST_HEIGHT; row++) {
      for (let col = 0; col < COAST_WIDTH; col++) {
        const province = col >= ISLE_FIRST_COL ? 3 : col <= SHORE_LAST_COL ? (row < 6 ? SHORE : QUIET) : 0;
        if (province === 0) continue;
        cells[row * COAST_WIDTH + col] = packCell({ owner: province, tier: 0, passable: true, biome: Biome.Plains });
      }
    }
    return new TerrainGrid(COAST_WIDTH, COAST_HEIGHT, cells, {
      provinces: [
        { index: SHORE, territory_id: 'shore', name: 'Shore' },
        { index: QUIET, territory_id: 'quiet', name: 'Quiet' },
        { index: 3, territory_id: 'isle', name: 'Isle' },
      ],
      ...(withLanes ? { lanes: [{ from: 'shore', to: 'isle' }] } : {}),
    });
  }

  const cellAt = (col: number, row: number) => row * COAST_WIDTH + col;

  /** A seat with villagers and a purse, played for a minute. Returns what it raised. */
  function play(options: {
    withLanes: boolean;
    seatCell: number;
    silver?: number;
    towers?: number;
  }): number[] {
    const terrain = coastGrid(options.withLanes);
    const sim = new Sim({
      seed: 9,
      terrain,
      scenario: {
        players: [{ index: 1, food: 1000, timber: 500, silver: options.silver ?? 500 }],
        buildings: [{ owner: 1, kind: BuildingKind.Seat, cell: options.seatCell }],
        units: [0, 1, 2].map((i) => ({
          owner: 1,
          kind: UnitKind.Villager,
          x: cellCentre(terrain.colOf(options.seatCell) + i),
          y: cellCentre(terrain.rowOf(options.seatCell)),
          speed: 0,
        })),
      },
    });
    // Towers off unless a test is about them, so the light is the only thing the military
    // branch can be reaching for and a pass cannot be a tower by another name.
    const bot = new TurtleBot({ towers: options.towers ?? 0 });
    const driver = new BotDriver(9, new Map([[1, bot]]), buildProvinceGeography(terrain));
    const raised: number[] = [];
    const seen = new Set<number>();
    while (sim.tick < TICKS_PER_MINUTE) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
      for (const b of sim.buildings.all()) {
        if (b.owner !== 1 || seen.has(b.id) || b.kind === BuildingKind.Seat) continue;
        seen.add(b.id);
        raised.push(b.kind);
      }
    }
    return raised;
  }

  it('raises one on a coast whose own province has a lane — and only one', () => {
    // Exactly one. Without the cap the policy would find a different coastal cell every
    // second and line the whole shore with lights, which is forty timber apiece for a
    // province it already watches.
    const raised = play({ withLanes: true, seatCell: cellAt(2, 2) });
    expect(raised.filter((k) => k === BuildingKind.Lighthouse)).toHaveLength(1);
  });

  it('raises one on a coast a province away from the lane', () => {
    // Quiet has no lane. A light there is worth forty timber only under the reading that
    // gives it a province of reach, so this is the policy asserting the same thing
    // `reveal.test.ts` asserts about the rule.
    expect(play({ withLanes: true, seatCell: cellAt(2, 9) })).toContain(BuildingKind.Lighthouse);
  });

  it('does not light a coast nothing crosses', () => {
    expect(play({ withLanes: false, seatCell: cellAt(2, 2) })).not.toContain(BuildingKind.Lighthouse);
  });

  it('spends its last silver on the tower, not the light', () => {
    // The brief's order — "towers on the shared border, lighthouse on the exposed coast" —
    // and both want the same twenty silver. Exactly one tower's worth in the purse, so
    // whichever it reaches for first is the only one it gets.
    const raised = play({ withLanes: true, seatCell: cellAt(2, 2), silver: 20, towers: 3 });
    expect(raised).toContain(BuildingKind.Tower);
    expect(raised).not.toContain(BuildingKind.Lighthouse);
  });
});

/**
 * The economy under rule VI, which is where every policy in the roster used to stop.
 *
 * Measured before these: a Colonist at Gaul froze at 76 timber from minute nine to the end
 * of a twenty-minute match, with six villagers and a lumber camp that earned six worker-
 * minutes out of a possible forty. The cause is a proportion rather than a bug. A villager
 * walks 54 cells a minute, no seat on the committed map has forest inside fourteen cells,
 * and `raidTargetCell` aims raids AT producing buildings — so the camp is both far away and
 * the thing raids go to, and a policy that evacuates on every sighting spends the match
 * commuting.
 *
 * Their own grid, because the committed map cannot express the fixed behaviour from two of
 * its four seats: Italy and Africa have no forest at all (see westernTwenty.test.ts), so a
 * test of "keeps its timber source earning" seated at Rome would be asserting something the
 * terrain makes impossible.
 */
describe('the economy holds up under raids', () => {
  const W = 60;
  const H = 24;
  const SEAT_CELL = 5 * W + 2;
  const FOREST_FIRST = 40;
  const FOREST_LAST = 45;

  /** Two provinces, with the forest far from the capital exactly as the real map has it. */
  function twoProvinces(): TerrainGrid {
    const cells = new Uint16Array(W * H);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const province = row < 12 ? 1 : 2;
        const inPatch = col >= FOREST_FIRST && col <= FOREST_LAST;
        const forest = inPatch;
        cells[row * W + col] = packCell({
          owner: province,
          tier: 0,
          passable: true,
          biome: forest ? Biome.Forest : Biome.Plains,
          // The pipeline sets the wooded flag on every cell the forest mask covers, plain
          // forest included, so forest-without-trees is a state the real asset cannot be
          // in. A synthetic grid that could would let a lumber-camp test pass on ground no
          // camp may actually stand on.
          wooded: forest,
        });
      }
    }
    return new TerrainGrid(W, H, cells, {
      provinces: [
        { index: 1, territory_id: 'home', name: 'Home' },
        { index: 2, territory_id: 'yonder', name: 'Yonder' },
      ],
    });
  }

  const cellAt = (col: number, row: number) => row * W + col;

  interface Setup {
    /** A finished lumber camp at this cell, with these villagers already on it. */
    camp?: number;
    tower?: number;
    /** Leave the tower as a construction site rather than a finished one. */
    towerUnfinished?: boolean;
    raider?: number;
    villagers?: number;
    seconds?: number;
    /**
     * The purse, kept deliberately tiny.
     *
     * A rich seat starts every building in its order at once and puts every villager on a
     * site as a builder, so the camp is never staffed and a test of who works where
     * measures the construction queue instead. Exactly one tower's worth, or nothing.
     */
    timber?: number;
    silver?: number;
  }

  function play(setup: Setup) {
    const terrain = twoProvinces();
    const buildings: Array<{ owner: number; kind: BuildingKindValue; cell: number }> = [
      { owner: 1, kind: BuildingKind.Seat, cell: SEAT_CELL },
    ];
    if (setup.camp !== undefined) buildings.push({ owner: 1, kind: BuildingKind.LumberCamp, cell: setup.camp });
    if (setup.tower !== undefined) buildings.push({ owner: 1, kind: BuildingKind.Tower, cell: setup.tower });

    const units = [];
    const near = setup.camp ?? SEAT_CELL;
    for (let i = 0; i < (setup.villagers ?? 3); i++) {
      units.push({
        owner: 1,
        kind: UnitKind.Villager,
        x: cellCentre(terrain.colOf(near) + i),
        y: cellCentre(terrain.rowOf(near)),
        speed: 0,
      });
    }
    if (setup.raider !== undefined) {
      units.push({
        owner: 0,
        kind: UnitKind.Skirmisher,
        x: cellCentre(terrain.colOf(setup.raider)),
        y: cellCentre(terrain.rowOf(setup.raider)),
        speed: 0,
      });
    }

    const sim = new Sim({
      seed: 21,
      terrain,
      scenario: {
        players: [{ index: 1, food: 2000, timber: setup.timber ?? 0, silver: setup.silver ?? 0 }],
        buildings: buildings as never,
        units,
      },
    });
    if (setup.towerUnfinished) {
      const tower = sim.buildings.all().find((b) => b.kind === BuildingKind.Tower)!;
      tower.complete = false;
      tower.progress = 0;
    }
    const bot = new ColonistBot();
    const driver = new BotDriver(21, new Map([[1, bot]]), buildProvinceGeography(terrain));
    const ticks = (setup.seconds ?? 20) * 15;
    // Worked ticks rather than a closing snapshot. The behaviour under test is whether the
    // camp KEEPS being worked across a match, and a snapshot lands arbitrarily inside the
    // flee-and-return cycle — it would read zero on a defended camp whose villagers happen
    // to be walking back at the final tick.
    let campWorkerTicks = 0;
    const SETTLE = 10 * 15;
    while (sim.tick < ticks) {
      driver.beforeTick(sim, sim.tick + 1);
      sim.step();
      if (sim.tick < SETTLE) continue;
      for (const b of sim.buildings.all()) {
        if (b.kind === BuildingKind.LumberCamp) campWorkerTicks += b.workers.length;
      }
    }
    return { sim, campWorkerTicks };
  }

  const campCell = cellAt(FOREST_FIRST + 2, 5);
  const TOWER_COST = BUILDING_SPECS[BuildingKind.Tower];
  /**
   * A raider the tower cannot reach, standing where the villagers can still see it.
   *
   * Eight cells from the camp and seven from the tower beside it: inside `fleeCells`, which
   * is 8, and outside the tower's range, which is 6. The first draft put it two cells away
   * and the tower shot it dead in six seconds — after which the camp was safe by the
   * ordinary rule and every villager went back to work, so the test passed with the clause
   * it was meant to be testing deleted. It was measuring the simulation's towers, not the
   * policy's reading of them.
   */
  const raiderCell = cellAt(FOREST_FIRST + 10, 5);
  const towerCell = cellAt(FOREST_FIRST + 3, 5);

  it('only ever proposes a lumber camp on wooded ground', () => {
    // Counts the ASKS, not the result. A build the simulation refuses is dropped in
    // silence, so a policy whose siting rule disagrees with the simulation's does not
    // fail — it just proposes the same impossible cell every second for the whole match.
    // That is how the port shipped with fourteen thousand refused commands in #333, and
    // the lumber camp's ground rule moved out of the biome list for the same reason the
    // port's never fitted in it.
    const { sim } = play({ seconds: 60, timber: BUILDING_SPECS[BuildingKind.LumberCamp].timber * 4 });
    const asks = sim
      .toReplay()
      .commands.filter((c) => c.command.type === 'build' && c.command.kind === BuildingKind.LumberCamp);
    expect(asks.length).toBeGreaterThan(0);
    for (const ask of asks) {
      expect(sim.terrain!.isWooded((ask.command as { cell: number }).cell)).toBe(true);
    }
  });

  it('writes off an outlying building a raider sits on, when nothing is defending it', () => {
    // Not "evacuates" — evacuating is right, and the policy still does it under a tower.
    // This is the part that was wrong: once the raid arrives, an undefended camp is never
    // offered as a job again, so it is written off for the rest of the match.
    const { campWorkerTicks } = play({ camp: campCell, raider: raiderCell, seconds: 60 });
    expect(campWorkerTicks).toBe(0);
  });

  it('goes back to that same ground when a tower of its own is holding it', () => {
    // The pair is the test. Same grid, same raider, same distance — the only difference is
    // one tower, and it is the difference between a timber economy and none. The villagers
    // still run; what changes is that the ground stays on the list of places worth working,
    // so they return to it. Since `raidTargetCell` aims raids AT producing buildings, "is a
    // raider near?" on its own answers yes essentially always, and the camp is abandoned
    // permanently the first time a raid finds it.
    const { campWorkerTicks } = play({ camp: campCell, tower: towerCell, raider: raiderCell, seconds: 60 });
    expect(campWorkerTicks).toBeGreaterThan(0);
  });

  it('does not count a tower that is still going up', () => {
    // A construction site shoots nothing — `stepCombat` skips any building that is not
    // complete — so treating one as cover would send villagers back into a raid on the
    // strength of a promise. Same rule the marching camp uses, for the same reason.
    const { campWorkerTicks } = play({
      camp: campCell,
      tower: towerCell,
      towerUnfinished: true,
      raider: raiderCell,
      seconds: 60,
    });
    expect(campWorkerTicks).toBe(0);
  });

  it('raises a tower over a timber source that is out on its own', () => {
    const { sim } = play({ camp: campCell, seconds: 40, timber: TOWER_COST.timber, silver: TOWER_COST.silver });
    const towers = sim.buildings.all().filter((b) => b.kind === BuildingKind.Tower);
    expect(towers).toHaveLength(1);
    const d = Math.max(
      Math.abs(sim.terrain!.colOf(towers[0].cell) - sim.terrain!.colOf(campCell)),
      Math.abs(sim.terrain!.rowOf(towers[0].cell) - sim.terrain!.rowOf(campCell)),
    );
    expect(d).toBeLessThanOrEqual(COMBAT_SPECS[BuildingKind.Tower]!.range);
  });

  it('does not spend a tower on work already under the seat', () => {
    // A camp beside the capital is under the seat's own tower, and a second one there is
    // eighty resources that buy nothing.
    const { sim } = play({ camp: cellAt(4, 5), seconds: 40, timber: TOWER_COST.timber, silver: TOWER_COST.silver });
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Tower)).toHaveLength(0);
  });

});

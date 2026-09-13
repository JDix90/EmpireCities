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
  TICKS_PER_MINUTE,
  UnitKind,
  seconds,
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

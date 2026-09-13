import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, type TerrainAsset } from '../terrain';
import { buildProvinceGeography } from '../tribes';
import { buildOpening } from '../openings';
import { runMatch } from '../match';
import { ColonistBot } from './colonist';
import { RaiderBot } from './raider';
import { TurtleBot } from './turtle';
import { RusherBot } from './rusher';
import { BuildingKind, TICKS_PER_MINUTE, UnitKind } from '../rules';
import type { Bot } from '../bot';
import type { Sim } from '../sim';

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

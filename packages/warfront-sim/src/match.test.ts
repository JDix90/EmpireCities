import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, Biome, packCell, type TerrainAsset } from './terrain';
import { buildOpening, SEATS, seatCellOf } from './openings';
import { runMatch } from './match';
import { ColonistBot } from './bots/colonist';
import { buildProvinceGeography } from './tribes';
import { botThinkOffset, botSeed, shouldThink, BOT_THINK_INTERVAL_TICKS, type Bot, type BotView } from './bot';
import { matchCapTicks } from './scoring';
import { BuildingKind, START_FOOD, START_SILVER, START_TIMBER, TICKS_PER_MINUTE, UnitKind } from './rules';
import { cellCentre } from './geometry';
import { Sim } from './sim';
import type { Command } from './commands';

const ASSET = join(__dirname, '..', '..', '..', 'database/warfront/western_twenty.terrain.json');
const realGrid = TerrainGrid.decode(JSON.parse(readFileSync(ASSET, 'utf8')) as TerrainAsset);
const realGeography = buildProvinceGeography(realGrid);

/** A four-province strip, for runner tests that do not need the real map. */
const WIDTH = 16;
const ROW = 1;
function stripGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  for (let c = 0; c < WIDTH; c++) {
    cells[ROW * WIDTH + c] = packCell({ owner: Math.floor(c / 4) + 1, tier: 0, passable: true, biome: Biome.Plains });
  }
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [
      { index: 1, territory_id: 'a', name: 'A' },
      { index: 2, territory_id: 'b', name: 'B' },
      { index: 3, territory_id: 'c', name: 'C' },
      { index: 4, territory_id: 'd', name: 'D' },
    ],
  });
}

describe('the opening', () => {
  it('seats every one of the brief’s four on ground it can stand on', () => {
    const { scenario, seats } = buildOpening(realGrid, { seats: 4 });
    expect(seats.map((s) => s.name)).toEqual(['Rome', 'Gaul', 'Carthage', 'Hispania']);
    expect(scenario.players).toHaveLength(4);
    for (const seat of seats) {
      expect(realGrid.isPassable(seat.cell)).toBe(true);
      expect(realGrid.owner(seat.cell)).toBe(realGrid.provinceIndex(seat.territoryId));
    }
  });

  it('defaults two seats to Rome against Gaul, per decision 22', () => {
    const { seats } = buildOpening(realGrid, { seats: 2 });
    expect(seats.map((s) => s.name)).toEqual(['Rome', 'Gaul']);
  });

  it("gives each seat the brief's starting stock", () => {
    const { scenario } = buildOpening(realGrid, { seats: 2 });
    for (const p of scenario.players!) {
      expect(p).toMatchObject({ food: START_FOOD, timber: START_TIMBER, silver: START_SILVER });
    }
    const own = scenario.units.filter((u) => u.owner === 1);
    expect(own.filter((u) => u.kind === UnitKind.Villager)).toHaveLength(4);
    expect(own.filter((u) => u.kind === UnitKind.Scout)).toHaveLength(1);
    expect(scenario.buildings!.every((b) => b.kind === BuildingKind.Seat)).toBe(true);
  });

  it('is deterministic — the same grid opens the same match every time', () => {
    expect(buildOpening(realGrid, { seats: 4 })).toEqual(buildOpening(realGrid, { seats: 4 }));
  });

  it('resolves every seat province named in the roster', () => {
    for (const seat of SEATS) expect(seatCellOf(realGrid, seat.territoryId)).toBeGreaterThanOrEqual(0);
  });

  it('refuses a province the asset does not carry', () => {
    expect(() => seatCellOf(realGrid, 'atlantis')).toThrow(/no province/);
  });
});

describe('bot cadence', () => {
  it('asks each seat once a second, not every tick', () => {
    let ticks = 0;
    for (let t = 1; t <= BOT_THINK_INTERVAL_TICKS * 4; t++) if (shouldThink(1, t)) ticks += 1;
    expect(ticks).toBe(4);
  });

  it('staggers the seats so they do not all decide on the same tick', () => {
    const offsets = [1, 2, 3, 4].map((seat) => botThinkOffset(seat));
    expect(new Set(offsets).size).toBe(4);
  });

  it('gives each seat its own generator seed, stable across runs', () => {
    expect(botSeed(7, 1)).toBe(botSeed(7, 1));
    expect(botSeed(7, 1)).not.toBe(botSeed(7, 2));
    expect(botSeed(7, 1)).not.toBe(botSeed(8, 1));
  });
});

describe('runMatch', () => {
  /** A policy that records what it saw and issues one order, once. */
  class ProbeBot implements Bot {
    readonly name = 'probe';
    views: BotView[] = [];
    constructor(private readonly order?: Command) {}
    think(view: BotView): Command[] {
      this.views.push(view);
      if (this.order && this.views.length === 1) return [this.order];
      return [];
    }
  }

  function stripOpening() {
    const grid = stripGrid();
    return {
      grid,
      scenario: {
        players: [
          { index: 1, food: 1000, timber: 100, silver: 0 },
          { index: 2, food: 1000, timber: 100, silver: 0 },
        ],
        buildings: [
          { owner: 1, kind: BuildingKind.Seat as 1, cell: ROW * WIDTH + 1 },
          { owner: 2, kind: BuildingKind.Seat as 1, cell: ROW * WIDTH + 13 },
        ],
        units: [
          { owner: 1, kind: UnitKind.Villager as 1, x: cellCentre(1), y: cellCentre(ROW), speed: 1 << 14 },
          { owner: 2, kind: UnitKind.Villager as 1, x: cellCentre(13), y: cellCentre(ROW), speed: 1 << 14 },
        ],
      },
    };
  }

  it('shows a bot its own seat, and the whole board it is allowed to see', () => {
    const { grid, scenario } = stripOpening();
    const bot = new ProbeBot();
    runMatch({ seed: 3, scenario, terrain: grid, bots: new Map([[1, bot]]), maxTicks: 60 });
    expect(bot.views.length).toBeGreaterThan(0);
    const view = bot.views[0];
    expect(view.seat).toBe(1);
    expect(view.player.index).toBe(1);
    expect(view.provinceCount).toBe(4);
    expect(view.colonisePrice).toBeGreaterThan(0);
    expect(view.geography.neighbours.size).toBe(4);
  });

  it("issues a bot's orders through the same command path a human uses", () => {
    const { grid, scenario } = stripOpening();
    const order: Command = { type: 'move', unit: 1, x: cellCentre(3), y: cellCentre(ROW) };
    runMatch({ seed: 3, scenario, terrain: grid, bots: new Map([[1, new ProbeBot(order)]]), maxTicks: 60 });
    // The proof it went through `issue` rather than some side channel: it is in the
    // replay, which is what a replay is for.
    const { grid: g2, scenario: s2 } = stripOpening();
    const out = runMatch({ seed: 3, scenario: s2, terrain: g2, bots: new Map([[1, new ProbeBot(order)]]), maxTicks: 60 });
    expect(out.replay.commands.map((c) => c.command)).toContainEqual(order);
  });

  it("keeps a bot's generator out of the simulation's own stream", () => {
    // No policy draws from `view.rng` today, so this is forward-looking — but it is the
    // invariant that matters when one does: the tribes read the SIMULATION's stream to
    // pick raid targets, so a bot pulling from it would make raids depend on how many
    // decisions its opponents happened to make that tick.
    class Greedy implements Bot {
      readonly name = 'greedy';
      think(view: BotView): Command[] {
        for (let i = 0; i < 50; i++) view.rng.nextU32();
        return [];
      }
    }
    const quiet = stripOpening();
    const noisy = stripOpening();
    const a = runMatch({ seed: 21, scenario: quiet.scenario, terrain: quiet.grid, bots: new Map(), maxTicks: 300 });
    const b = runMatch({
      seed: 21,
      scenario: noisy.scenario,
      terrain: noisy.grid,
      bots: new Map<number, Bot>([[1, new Greedy()]]),
      maxTicks: 300,
    });
    expect(b.hash).toBe(a.hash);
  });

  it('records which policy played which seat', () => {
    const { grid, scenario } = stripOpening();
    const out = runMatch({
      seed: 3, scenario, terrain: grid, maxTicks: 30,
      bots: new Map<number, Bot>([[1, new ColonistBot()], [2, new ProbeBot()]]),
    });
    expect(out.policies).toEqual({ 1: 'colonist', 2: 'probe' });
  });

  it('stops at the format cap when nothing decides it sooner', () => {
    const { grid, scenario } = stripOpening();
    const out = runMatch({ seed: 3, scenario, terrain: grid, bots: new Map() });
    expect(out.ticks).toBe(matchCapTicks(2));
    expect(out.result.reason).toBe('cap');
    expect(out.decided).toBe(true);
  });

  it('honours a shorter cap, and says the match was not decided', () => {
    const { grid, scenario } = stripOpening();
    const out = runMatch({ seed: 3, scenario, terrain: grid, bots: new Map(), maxTicks: 100 });
    expect(out.ticks).toBe(100);
    expect(out.decided).toBe(false);
  });

  it('replays to the same hash — the whole reason bots go through the command API', () => {
    const play = () => {
      const { grid, scenario } = stripOpening();
      return runMatch({
        seed: 99, scenario, terrain: grid, maxTicks: 600,
        bots: new Map([[1, new ColonistBot()], [2, new ColonistBot()]]),
      });
    };
    const a = play();
    const b = play();
    expect(b.hash).toBe(a.hash);
    expect(b.replay.commands).toEqual(a.replay.commands);
  });

  it('reproduces a bot match from its replay alone, with no bots at all', () => {
    const { grid, scenario } = stripOpening();
    const live = runMatch({
      seed: 5, scenario, terrain: grid, maxTicks: 600,
      bots: new Map([[1, new ColonistBot()], [2, new ColonistBot()]]),
    });
    const replayed = Sim.fromReplay(live.replay, stripGrid());
    replayed.runTo(live.ticks);
    expect(replayed.hash()).toBe(live.hash);
  });
});


describe('the Colonist on the real map', () => {
  it('opens by raising the only thing that makes more timber', () => {
    const { scenario } = buildOpening(realGrid, { seats: 2 });
    let firstBuilt: number | null = null;
    runMatch({
      seed: 4242, scenario, terrain: realGrid, geography: realGeography,
      bots: new Map([[2, new ColonistBot()]]),
      maxTicks: TICKS_PER_MINUTE * 3,
      observe: (sim) => {
        if (firstBuilt !== null) return;
        const raised = sim.buildings.all().find((b) => b.owner === 2 && b.kind !== BuildingKind.Seat);
        if (raised) firstBuilt = raised.kind;
      },
    });
    expect(firstBuilt).toBe(BuildingKind.LumberCamp);
  });

  it('walks its build order in sequence, rather than grouping it by kind', () => {
    // The order is [lumber camp, farm, barracks, farm, mine]. Tallying it by kind — "one
    // camp wanted, TWO farms wanted, one barracks" — reorders it into both farms before
    // the barracks, which is how the first version spent its whole opening purse on farms
    // and could never afford the camp. The tell is what follows the first farm.
    const { scenario } = buildOpening(realGrid, { seats: 2 });
    const sequence: number[] = [];
    const seen = new Set<number>();
    runMatch({
      seed: 4242, scenario, terrain: realGrid, geography: realGeography,
      bots: new Map([[2, new ColonistBot()]]),
      maxTicks: TICKS_PER_MINUTE * 6,
      observe: (sim) => {
        for (const b of sim.buildings.all()) {
          if (b.owner !== 2 || seen.has(b.id)) continue;
          seen.add(b.id);
          // A house jumps the queue when population binds, which is the one documented
          // exception to the order, so it is not part of the sequence being asserted.
          if (b.kind !== BuildingKind.Seat && b.kind !== BuildingKind.House) sequence.push(b.kind);
        }
      },
    });
    expect(sequence.slice(0, 3)).toEqual([BuildingKind.LumberCamp, BuildingKind.Farm, BuildingKind.Barracks]);
  });

  it('never deadlocks its own build order on timber', () => {
    // The first version tallied the order by kind instead of walking it, which spent the
    // opening purse on farms and left it thirty timber short of the lumber camp — with no
    // lumber camp, timber never moves again for the rest of the match.
    const { scenario } = buildOpening(realGrid, { seats: 2 });
    const timberOverTime: number[] = [];
    runMatch({
      seed: 4242, scenario, terrain: realGrid, geography: realGeography,
      bots: new Map([[2, new ColonistBot()]]),
      maxTicks: TICKS_PER_MINUTE * 6,
      observe: (sim) => {
        if (sim.tick % TICKS_PER_MINUTE === 0) timberOverTime.push(sim.players.get(2)!.timber);
      },
    });
    // Gaul has forest, so it raises a camp and its timber moves again after the spend.
    expect(Math.max(...timberOverTime.slice(2))).toBeGreaterThan(Math.min(...timberOverTime));
  });

  it('trains, assigns and builds — it plays, rather than standing still', () => {
    const { scenario } = buildOpening(realGrid, { seats: 2 });
    const out = runMatch({
      seed: 4242, scenario, terrain: realGrid, geography: realGeography,
      bots: new Map([[1, new ColonistBot()], [2, new ColonistBot()]]),
      maxTicks: TICKS_PER_MINUTE * 5,
    });
    const kinds = new Set(out.replay.commands.map((c) => c.command.type));
    expect(kinds.has('build')).toBe(true);
    expect(kinds.has('assign')).toBe(true);
    expect(kinds.has('train')).toBe(true);
  });

  it('is deterministic on the real map too', () => {
    const play = () => {
      const { scenario } = buildOpening(realGrid, { seats: 2 });
      return runMatch({
        seed: 17, scenario, terrain: realGrid, geography: realGeography,
        bots: new Map([[1, new ColonistBot()], [2, new ColonistBot()]]),
        maxTicks: TICKS_PER_MINUTE * 4,
      }).hash;
    };
    expect(play()).toBe(play());
  });
});

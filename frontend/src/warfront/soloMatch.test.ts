import { describe, it, expect } from 'vitest';
import {
  Biome,
  BuildingKind,
  Sim,
  TerrainGrid,
  UnitKind,
  packCell,
  toIntFloor,
} from '@borderfall/warfront-sim';
import { POLICIES, buildSoloMatch } from './soloMatch';

/**
 * Two walkable bands, one per seat, in the order `buildOpening` seats them: Rome first,
 * then Gaul, which is decision 22's default matchup.
 */
const WIDTH = 24;
const ROW = 1;

/**
 * Each province carries plains, a forest cell and a highland cell, because a policy is
 * mostly a BUILD ORDER and a grid with no forest lets nobody raise a lumber camp — on
 * which every policy stalls at the same point and plays identically. A test map has to be
 * able to express the thing under test.
 */
function testGrid(): TerrainGrid {
  const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
  const cells = new Uint16Array(WIDTH * 3).fill(sea);
  const band = (owner: number, from: number, to: number) => {
    for (let c = from; c < to; c++) {
      const biome = c === from + 1 ? Biome.Forest : c === from + 2 ? Biome.Highland : Biome.Plains;
      cells[ROW * WIDTH + c] = packCell({
        owner,
        tier: biome === Biome.Highland ? 1 : 0,
        passable: true,
        biome,
      });
    }
  };
  band(1, 1, 7);
  band(2, 12, 18);
  band(3, 19, 23);
  return new TerrainGrid(WIDTH, 3, cells, {
    provinces: [
      { index: 1, territory_id: 'italia_central', name: 'Italia & Roma' },
      { index: 2, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' },
      { index: 3, territory_id: 'africa_proconsularis', name: 'Africa Proconsularis' },
    ],
  });
}

const grid = testGrid();

describe('the opponents on offer', () => {
  it('are the lab roster, each with a line saying what it does', () => {
    expect(POLICIES.map((p) => p.name)).toEqual(['colonist', 'raider', 'turtle', 'rusher']);
    // A policy name a player cannot read is a coin flip rather than a decision.
    for (const policy of POLICIES) expect(policy.blurb.length).toBeGreaterThan(20);
  });
});

describe('buildSoloMatch', () => {
  it('seats the player and a policy in every other seat', () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['rusher'] });
    expect(match.playerSeat).toBe(1);
    expect(match.seatNames).toEqual({ 1: 'Rome', 2: 'Gaul' });
    expect(match.driver.seats).toEqual([2]);
    expect(match.driver.policies).toEqual({ 2: 'rusher' });
  });

  it('never hands the player their own seat to a bot', () => {
    const match = buildSoloMatch(grid, 7, { seats: 3, playerSeat: 1, opponents: ['colonist', 'turtle'] });
    expect(match.driver.seats).toEqual([2, 3]);
    expect(match.driver.policies[1]).toBeUndefined();
  });

  it('opens the player on walkable ground in their own province', () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] });
    expect(grid.isPassable(match.playerSeatCell)).toBe(true);
    expect(grid.owner(match.playerSeatCell)).toBe(1);
  });

  it("falls back to the baseline when an opponent is not named", () => {
    const match = buildSoloMatch(grid, 7, { seats: 3, playerSeat: 1, opponents: [] });
    expect(Object.values(match.driver.policies)).toEqual(['colonist', 'colonist']);
  });

  it('produces a scenario the simulation accepts, with a seat per player', () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] });
    const sim = new Sim({ seed: 7, scenario: match.scenario, terrain: grid });
    expect(sim.hasEconomy).toBe(true);
    expect(sim.players.size).toBe(2);
    expect(sim.buildings.all().filter((b) => b.kind === BuildingKind.Seat)).toHaveLength(2);
    expect(sim.provinces.get(1)!.owner).toBe(1);
    expect(sim.provinces.get(2)!.owner).toBe(2);
  });
});

describe('the driver', () => {
  /** Runs a match the way the page does: ask the bots, then step. */
  function play(match: ReturnType<typeof buildSoloMatch>, ticks: number): Sim {
    const sim = new Sim({ seed: 7, scenario: match.scenario, terrain: grid });
    for (let i = 0; i < ticks; i++) {
      match.driver.beforeTick(sim, sim.tick + 1);
      sim.step();
    }
    return sim;
  }

  it('orders only the seats it plays, and leaves the player alone', () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] });
    const sim = play(match, 400);
    const commands = sim.toReplay().commands;
    expect(commands.length).toBeGreaterThan(0);
    // Every ordered unit or building belongs to the bot's seat, never the player's.
    for (const entry of commands) {
      const c = entry.command;
      const owner =
        'unit' in c && c.type !== 'train'
          ? sim.entities.get(c.unit)?.owner
          : c.type === 'train'
            ? sim.buildings.get(c.building)?.owner
            : undefined;
      if (owner !== undefined) expect(owner).not.toBe(1);
    }
  });

  it("puts the bot's orders in the replay, like any other player's", () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] });
    const sim = play(match, 400);
    const replay = sim.toReplay();
    expect(replay.commands.length).toBeGreaterThan(0);
    // The proof it is a real replay: rebuilding from it alone, with no bots present at
    // all, reaches the same state.
    const replayed = Sim.fromReplay(replay, testGrid());
    replayed.runTo(sim.tick);
    expect(replayed.hash()).toBe(sim.hash());
  });

  it('is deterministic, so the same seed plays the same match', () => {
    const once = play(buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['raider'] }), 300).hash();
    const twice = play(buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['raider'] }), 300).hash();
    expect(twice).toBe(once);
  });

  it('gives a different match for a different opponent', () => {
    // Colonist and Raider differ at their SECOND building — a farm against a barracks —
    // so the run has to be long enough for one to be sited. Colonist against Rusher would
    // pass only by luck: those two order the same things for the first several minutes,
    // and a test that compared them early would be asserting nothing.
    const colonist = play(buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] }), 2400).hash();
    const raider = play(buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['raider'] }), 2400).hash();
    expect(raider).not.toBe(colonist);
  });

  it('leaves the player’s own units exactly where they started', () => {
    const match = buildSoloMatch(grid, 7, { seats: 2, playerSeat: 1, opponents: ['colonist'] });
    const sim = new Sim({ seed: 7, scenario: match.scenario, terrain: grid });
    const before = [...sim.entities.all()]
      .filter((u) => u.owner === 1 && u.kind === UnitKind.Villager)
      .map((u) => ({ id: u.id, cell: grid.index(toIntFloor(u.x), toIntFloor(u.y)) }));
    for (let i = 0; i < 300; i++) {
      match.driver.beforeTick(sim, sim.tick + 1);
      sim.step();
    }
    for (const { id, cell } of before) {
      const unit = sim.entities.get(id);
      // Nobody ordered them, so they are still standing where the opening put them.
      expect(unit && grid.index(toIntFloor(unit.x), toIntFloor(unit.y))).toBe(cell);
    }
  });
});

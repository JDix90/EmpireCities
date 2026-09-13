import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, type TerrainAsset } from '../terrain';
import { buildProvinceGeography } from '../tribes';
import { playBatch, playOne, permutations, seatFairness, type BotFactory } from './run';
import { summarise } from './metrics';
import { ColonistBot } from '../bots/colonist';
import { RaiderBot } from '../bots/raider';
import { TurtleBot } from '../bots/turtle';
import { RusherBot } from '../bots/rusher';
import { matchCapTicks } from '../scoring';
import { TICKS_PER_MINUTE } from '../rules';

/**
 * The invariants CI enforces.
 *
 * These are things that must be true of ANY correct simulation, not of a well-balanced
 * one: matches terminate, they reproduce, and bots never issue an order the simulation
 * rejects. The brief's design questions — first contact between four and eight minutes,
 * no seat above 55%, a third of games ending on the clock — are deliberately NOT here.
 * A lab that asserted its own answers could only ever confirm them; those numbers are
 * measured by `pnpm run lab` and reported, so a miss is a finding rather than a red build.
 *
 * Everything runs short on purpose. CI is not the overnight sweep.
 */

const ASSET = join(__dirname, '..', '..', '..', '..', 'database/warfront/western_twenty.terrain.json');
const grid = TerrainGrid.decode(JSON.parse(readFileSync(ASSET, 'utf8')) as TerrainAsset);
const geography = buildProvinceGeography(grid);

/** Three minutes is enough for every invariant here and keeps the job in seconds. */
const SHORT = TICKS_PER_MINUTE * 3;

const FACTORIES: Record<string, BotFactory> = {
  colonist: () => new ColonistBot(),
  raider: () => new RaiderBot(),
  turtle: () => new TurtleBot(),
  rusher: () => new RusherBot(),
};

function twoSeats(a: string, b: string): ReadonlyMap<number, BotFactory> {
  return new Map<number, BotFactory>([
    [1, FACTORIES[a]],
    [2, FACTORIES[b]],
  ]);
}

describe('every policy can play a match without breaking the simulation', () => {
  for (const name of Object.keys(FACTORIES)) {
    it(`${name} issues only orders the simulation accepts`, () => {
      // `sim.issue` validates and throws on a malformed command, so a match that runs to
      // completion is the assertion: no float smuggled into a replay, no out-of-range id.
      const { outcome } = playOne(
        { terrain: grid, geography, policies: twoSeats(name, name), seeds: [], maxTicks: SHORT },
        11,
      );
      expect(outcome.ticks).toBe(SHORT);
      expect(outcome.replay.commands.length).toBeGreaterThan(0);
      for (const c of outcome.replay.commands) {
        for (const value of Object.values(c.command)) {
          if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
        }
      }
    });
  }
});

describe('matches terminate', () => {
  it('never runs past the format cap', () => {
    const { outcome } = playOne({ terrain: grid, geography, policies: twoSeats('colonist', 'colonist'), seeds: [] }, 3);
    expect(outcome.ticks).toBeLessThanOrEqual(matchCapTicks(2));
    expect(outcome.result.over).toBe(true);
  });

  it('always produces a full set of standings, in place order', () => {
    const { outcome } = playOne(
      { terrain: grid, geography, policies: twoSeats('colonist', 'rusher'), seeds: [], maxTicks: SHORT },
      4,
    );
    const places = outcome.result.standings.map((s) => s.place);
    expect(places).toEqual([1, 2]);
  });
});

describe('the lab reproduces', () => {
  it('gives the same hashes for the same seeds, every time', () => {
    const run = () =>
      playBatch({
        terrain: grid,
        geography,
        policies: twoSeats('colonist', 'raider'),
        seeds: [1, 2, 3],
        maxTicks: SHORT,
      });
    const a = run();
    const b = run();
    expect(b.hashes).toEqual(a.hashes);
    expect(b.summary).toEqual(a.summary);
  });

  it('gives different matches for different seeds', () => {
    const { hashes } = playBatch({
      terrain: grid,
      geography,
      policies: twoSeats('colonist', 'colonist'),
      seeds: [1, 2, 3],
      maxTicks: SHORT,
    });
    // Tribes draw from the seeded stream, so the seed genuinely changes a match.
    expect(new Set(hashes).size).toBeGreaterThan(1);
  });

  it('measures the same numbers from the same matches', () => {
    const batch = playBatch({
      terrain: grid,
      geography,
      policies: twoSeats('turtle', 'turtle'),
      seeds: [7, 8],
      maxTicks: SHORT,
    });
    expect(summarise(batch.metrics)).toEqual(batch.summary);
  });
});

describe('permutations', () => {
  it('produces every ordering exactly once, in a fixed order', () => {
    expect(permutations([1, 2, 3])).toEqual([
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ]);
    expect(permutations([1, 2, 3, 4])).toHaveLength(24);
    expect(new Set(permutations([1, 2, 3, 4]).map((p) => p.join(''))).size).toBe(24);
  });

  it('handles the degenerate cases', () => {
    expect(permutations([])).toEqual([[]]);
    expect(permutations([9])).toEqual([[9]]);
  });
});

describe('seat fairness', () => {
  it('rotates every seat through every province, and reports a spread', () => {
    const result = seatFairness({
      terrain: grid,
      geography,
      policy: FACTORIES.colonist,
      seats: 2,
      repeats: 1,
      baseSeed: 99,
      maxTicks: TICKS_PER_MINUTE,
    });
    // Two seats, both orderings: each province plays both seat indices exactly once.
    expect(result.matches).toBe(2);
    expect(result.rows.map((r) => r.name)).toEqual(['Rome', 'Gaul']);
    for (const row of result.rows) expect(row.played).toBe(2);
    expect(result.spreadPercent).toBeGreaterThanOrEqual(0);
  });

  it('is reproducible from its base seed alone', () => {
    const run = () =>
      seatFairness({
        terrain: grid,
        geography,
        policy: FACTORIES.colonist,
        seats: 2,
        repeats: 1,
        baseSeed: 1234,
        maxTicks: TICKS_PER_MINUTE,
      });
    expect(run()).toEqual(run());
  });
});

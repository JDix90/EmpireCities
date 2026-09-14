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
import { IslanderBot, MarinerBot } from '../bots/seafarer';
import { matchCapTicks } from '../scoring';
import { SEATS } from '../openings';
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
  islander: () => new IslanderBot(),
  mariner: () => new MarinerBot(),
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

/**
 * Every policy, from every seat on the roster, actually runs an economy.
 *
 * This is an invariant and not a balance target, which is why it is here rather than in
 * the report: a policy that raises nothing is not playing badly, it is not playing. The
 * distinction had teeth. Nothing in this suite used to look at what a bot BUILT — the
 * golden fixtures are frozen command logs, so they reproduce a recording of the bots
 * rather than the bots, and the reproducibility tests compare a run to itself. A policy
 * could therefore go completely inert and all of CI stayed green, which is exactly what
 * happened: the committed map gives Rome and Carthage no forest anywhere in their home
 * province, the build order stalled on a lumber camp that had nowhere to go, and both
 * seats played whole matches without raising one building — banking their opening food
 * for a colony they had no income to pay for, then starving.
 *
 * Seat-by-seat rather than once, because that failure was a property of the GROUND. A
 * check that only ever opened Gaul would have passed every time.
 */
describe('every policy runs an economy, from every seat', () => {
  // Long enough for the opening build to be finished and worked, short enough for CI:
  // the first producing building is up inside a minute from any seat on this map.
  const HORIZON = TICKS_PER_MINUTE * 2;

  for (const name of Object.keys(FACTORIES)) {
    for (const seat of SEATS) {
      it(`${name} raises a producing building from ${seat.name}, and works it`, () => {
        // The policy under test sits in seat 1 and the roster's first OTHER seat fills
        // the second chair, so the match is a real two-seat game whichever seat is being
        // examined.
        const other = SEATS.find((s) => s.territoryId !== seat.territoryId)!;
        const { metrics } = playOne(
          {
            terrain: grid,
            geography,
            policies: twoSeats(name, name),
            seeds: [],
            territoryIds: [seat.territoryId, other.territoryId],
            maxTicks: HORIZON,
          },
          29,
        );
        expect(metrics.producingAtEnd[1]).toBeGreaterThan(0);
        expect(metrics.firstProducingTick[1]).not.toBeNull();
        // Deliberately NOT asserting `workedSeconds` here, though it is now measured.
        // Every threshold tried was toothless: disabling the policy's entire employment
        // step moves a two-minute horizon from 110 worked seconds to 98, because a
        // villager that BUILDS a farm stays on it as a worker afterwards. And the honest
        // threshold — "still working at minute six", where the roster actually stalls —
        // fails today for two of the twenty-four combinations. The economy's real ceiling
        // is set by rule VI's raid volume and by two seats having no timber on this map at
        // all, neither of which is a correctness property this file can assert. It is
        // reported instead, as `medianTimberWorkedPercent`.
      });
    }
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

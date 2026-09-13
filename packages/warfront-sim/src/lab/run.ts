import { buildOpening, SEATS } from '../openings';
import { runMatch, type MatchOutcome } from '../match';
import { buildProvinceGeography, type ProvinceGeography } from '../tribes';
import { MetricsCollector, percentOf, summarise, type MatchMetrics, type Summary } from './metrics';
import type { Bot } from '../bot';
import type { TerrainGrid } from '../terrain';

/**
 * The lab: many matches, no renderer, and the numbers that come out of them.
 *
 * Because the simulation is deterministic and headless a match costs a few seconds rather
 * than twenty minutes, so the questions in the brief's design table can be answered by
 * measurement instead of argument. Nothing here is random: a batch is a list of seeds, and
 * the same list reproduces the same numbers on any machine.
 */

export type BotFactory = () => Bot;

export interface BatchOptions {
  terrain: TerrainGrid;
  /** Seat index → how to build that seat's policy. A fresh bot per match: they hold state. */
  policies: ReadonlyMap<number, BotFactory>;
  /** One match per seed. */
  seeds: readonly number[];
  /** Shorten matches when sampling the opening rather than whole games. */
  maxTicks?: number;
  /** Reused across the batch — it depends on the grid alone and costs a full pass. */
  geography?: ProvinceGeography;
  /** Territory ids to seat, in order. Defaults to the roster for the policy count. */
  territoryIds?: readonly string[];
}

export interface BatchResult {
  metrics: MatchMetrics[];
  summary: Summary;
  /** Every match's final hash, so a batch can be compared to a previous run exactly. */
  hashes: string[];
}

/** Plays one match and measures it. */
export function playOne(options: BatchOptions, seed: number): { outcome: MatchOutcome; metrics: MatchMetrics } {
  const seats = [...options.policies.keys()].sort((a, b) => a - b);
  const { scenario } = buildOpening(options.terrain, {
    seats: seats.length,
    ...(options.territoryIds ? { territoryIds: options.territoryIds } : {}),
  });
  const collector = new MetricsCollector(seats);
  const bots = new Map<number, Bot>();
  for (const seat of seats) bots.set(seat, options.policies.get(seat)!());

  const outcome = runMatch({
    seed,
    scenario,
    terrain: options.terrain,
    bots,
    ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
    ...(options.geography ? { geography: options.geography } : {}),
    observe: collector.observe,
  });
  return { outcome, metrics: collector.finish(seed, outcome.result, outcome.ticks, outcome.policies) };
}

/** Plays every seed and rolls the results up. */
export function playBatch(options: BatchOptions): BatchResult {
  const geography = options.geography ?? buildProvinceGeography(options.terrain);
  const metrics: MatchMetrics[] = [];
  const hashes: string[] = [];
  for (const seed of options.seeds) {
    const { outcome, metrics: m } = playOne({ ...options, geography }, seed);
    metrics.push(m);
    hashes.push(outcome.hash);
  }
  return { metrics, summary: summarise(metrics), hashes };
}

/** Every ordering of `n` items, in a fixed order so a batch is reproducible. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

export interface FairnessOptions {
  terrain: TerrainGrid;
  /** The one policy every seat plays. Fairness is a property of the MAP, not of a matchup. */
  policy: BotFactory;
  seats: number;
  /** Matches per permutation. */
  repeats: number;
  /** Seeds are derived from this, so the whole sweep reproduces from one number. */
  baseSeed: number;
  maxTicks?: number;
  geography?: ProvinceGeography;
}

export interface FairnessRow {
  territoryId: string;
  name: string;
  played: number;
  won: number;
  winPercent: number;
}

export interface FairnessResult {
  rows: FairnessRow[];
  /** Largest gap between any two seats' win rates, in percentage points. */
  spreadPercent: number;
  matches: number;
  summary: Summary;
}

/**
 * Seat fairness by self-play — "the first thing to build", per the brief.
 *
 * The same policy in every seat, every permutation of who sits where, repeated. The
 * win-rate deviation IS the map's imbalance as a number, which is what turns "Rome is
 * overpowered" from a forum argument into something starting bonuses can be moved against.
 *
 * Permuting matters because seat INDEX is not neutral: seat 1 thinks on a different tick
 * from seat 4, and without rotating the provinces through the indices the sweep would be
 * measuring that instead of the map.
 */
export function seatFairness(options: FairnessOptions): FairnessResult {
  const geography = options.geography ?? buildProvinceGeography(options.terrain);
  const roster = SEATS.slice(0, options.seats).map((s) => s.territoryId);
  const orders = permutations(roster);
  const metrics: MatchMetrics[] = [];
  const played = new Map<string, number>();
  const won = new Map<string, number>();
  for (const id of roster) {
    played.set(id, 0);
    won.set(id, 0);
  }

  let seed = options.baseSeed;
  for (const order of orders) {
    for (let r = 0; r < options.repeats; r++) {
      const policies = new Map<number, BotFactory>();
      for (let i = 0; i < order.length; i++) policies.set(i + 1, options.policy);
      const { metrics: m } = playOne(
        {
          terrain: options.terrain,
          policies,
          seeds: [],
          territoryIds: order,
          geography,
          ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
        },
        seed,
      );
      seed += 1;
      metrics.push(m);
      order.forEach((id, i) => {
        played.set(id, (played.get(id) ?? 0) + 1);
        if (m.winner === i + 1) won.set(id, (won.get(id) ?? 0) + 1);
      });
    }
  }

  const rows: FairnessRow[] = roster.map((id) => {
    const p = played.get(id) ?? 0;
    const w = won.get(id) ?? 0;
    return {
      territoryId: id,
      name: SEATS.find((s) => s.territoryId === id)?.name ?? id,
      played: p,
      won: w,
      winPercent: percentOf(w, p),
    };
  });
  const rates = rows.map((r) => r.winPercent);
  return {
    rows,
    spreadPercent: rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 0,
    matches: metrics.length,
    summary: summarise(metrics),
  };
}

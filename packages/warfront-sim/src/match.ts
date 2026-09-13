import { Sim, type Replay, type Scenario } from './sim';
import { BOT_THINK_INTERVAL_TICKS, rngFor, shouldThink, viewFor, type Bot } from './bot';
import { buildProvinceGeography, type ProvinceGeography } from './tribes';
import { matchCapTicks, type MatchResult } from './scoring';
import { assertInt } from './fixed';
import type { TerrainGrid } from './terrain';

/**
 * The headless runner: a match played by policies, at whatever speed the machine allows.
 *
 * Because the simulation is deterministic and has no renderer, this is the whole lab —
 * thousands of matches overnight, and the economy figures in the brief get corrected
 * before a human ever sees them.
 *
 * Bots drive `sim.issue` exactly as a human does, so their orders land in the replay and
 * a recorded match reproduces from its seed and command log alone. The runner adds no
 * authority of its own: it decides WHEN a bot is asked for orders, and nothing else.
 */

export interface MatchOptions {
  seed: number;
  scenario: Scenario;
  terrain: TerrainGrid;
  /** Seat index → the policy playing it. A seat with no bot simply does nothing. */
  bots: ReadonlyMap<number, Bot>;
  /**
   * Hard stop, in ticks. Defaults to the format's own cap for the seat count. A lab that
   * wants short samples passes a smaller one; nothing runs forever by accident.
   */
  maxTicks?: number;
  /** Ticks between a bot's decisions. The default is once a second — see bot.ts. */
  thinkInterval?: number;
  /**
   * Prebuilt province geography, for a lab running many matches on one grid: deriving it
   * costs a pass over six hundred thousand cells, and the answer depends on the grid
   * alone, so it is worth computing once and handing in.
   */
  geography?: ProvinceGeography;
  /** Called after every tick. For metrics; it must not touch the simulation. */
  observe?: (sim: Sim) => void;
}

export interface MatchOutcome {
  result: MatchResult;
  /** Ticks actually simulated. */
  ticks: number;
  /** True when the match ended on its own terms rather than hitting `maxTicks`. */
  decided: boolean;
  /** Seat index → the policy that played it, for the record. */
  policies: Record<number, string>;
  hash: string;
  replay: Replay;
}

/**
 * Plays a match to its end and returns the outcome.
 *
 * The order inside a tick matters and is fixed: bots decide BEFORE the tick is simulated,
 * so an order issued on tick N is stamped for N+2 and lands in the same place it would
 * for a human pressing a key at that moment. Checking the result after the step means a
 * match that ends on a majority ends on the tick it was reached, not a tick later.
 */
export function runMatch(options: MatchOptions): MatchOutcome {
  const seed = assertInt(options.seed, 'match seed');
  const sim = new Sim({ seed, scenario: options.scenario, terrain: options.terrain });
  const geography = options.geography ?? buildProvinceGeography(options.terrain);
  const interval = options.thinkInterval ?? BOT_THINK_INTERVAL_TICKS;
  const cap = options.maxTicks ?? matchCapTicks(sim.players.size);

  const rngs = new Map<number, ReturnType<typeof rngFor>>();
  const policies: Record<number, string> = {};
  for (const [seat, bot] of options.bots) {
    rngs.set(seat, rngFor(seed, seat));
    policies[seat] = bot.name;
  }

  let result = sim.result;
  while (!result.over && sim.tick < cap) {
    const next = sim.tick + 1;
    for (const [seat, bot] of options.bots) {
      if (!shouldThink(seat, next, interval)) continue;
      const view = viewFor(sim, seat, rngs.get(seat)!, geography);
      // A seat whose player is gone from the match has nothing to order.
      if (!view) continue;
      for (const command of bot.think(view)) sim.issue(command);
    }
    sim.step();
    options.observe?.(sim);
    result = sim.result;
  }

  return {
    result,
    ticks: sim.tick,
    decided: result.over,
    policies,
    hash: sim.hash(),
    replay: sim.toReplay(),
  };
}

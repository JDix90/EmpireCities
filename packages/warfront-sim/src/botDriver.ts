import { BOT_THINK_INTERVAL_TICKS, rngFor, shouldThink, viewFor, type Bot } from './bot';
import type { ProvinceGeography } from './tribes';
import type { Rng } from './rng';
import type { Sim } from './sim';

/**
 * Drives a set of policies against a running simulation, one tick at a time.
 *
 * The lab and the live game share this deliberately. A bot that decided on a different
 * cadence, or saw a different view, or drew from a different stream when a human is
 * watching would make every number the lab produces a statement about a game nobody
 * plays. One driver, one answer.
 *
 * It adds no authority of its own: it decides WHEN a seat is asked for orders, and the
 * orders go through `sim.issue` exactly as a human's do.
 */
export class BotDriver {
  readonly policies: Record<number, string> = {};
  private readonly rngs = new Map<number, Rng>();
  private readonly interval: number;

  constructor(
    seed: number,
    private readonly bots: ReadonlyMap<number, Bot>,
    private readonly geography: ProvinceGeography,
    interval: number = BOT_THINK_INTERVAL_TICKS,
  ) {
    this.interval = interval;
    for (const [seat, bot] of bots) {
      this.rngs.set(seat, rngFor(seed, seat));
      this.policies[seat] = bot.name;
    }
  }

  /** Seats currently played by a policy. */
  get seats(): number[] {
    return [...this.bots.keys()].sort((a, b) => a - b);
  }

  /**
   * Asks whichever seats are due, and issues what they return.
   *
   * Call it immediately BEFORE `sim.step()`, with the tick that is about to be simulated:
   * an order issued now is stamped two ticks ahead, which is where a human pressing a key
   * at this moment would land too.
   */
  beforeTick(sim: Sim, nextTick: number): void {
    for (const [seat, bot] of this.bots) {
      if (!shouldThink(seat, nextTick, this.interval)) continue;
      const view = viewFor(sim, seat, this.rngs.get(seat)!, this.geography);
      // A seat whose player has left the match has nothing to order.
      if (!view) continue;
      for (const command of bot.think(view)) sim.issue(command);
    }
  }
}

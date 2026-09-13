import { START_FOOD, START_SILVER, START_TIMBER } from './rules';
import type { StateHasher } from './hash';

/**
 * Per-seat economic state.
 *
 * The accumulators are the reason this is exact. A farmer yields 12 food a MINUTE, which
 * is 12/900 a tick — not an integer, and the package forbids fractions in state. So each
 * tick adds the per-minute rate to an accumulator and whole units are flushed when it
 * reaches TICKS_PER_MINUTE. Over 900 ticks a farmer delivers exactly 12 food on every
 * machine, with no rounding drift to diverge a replay.
 */

export interface Player {
  readonly index: number;
  food: number;
  timber: number;
  silver: number;
  /** Population currently used by living units. */
  pop: number;
  /** Population cap from the seat and houses. */
  popCap: number;
  /** Income accumulators, one per resource (see the note above). */
  foodAcc: number;
  timberAcc: number;
  silverAcc: number;
  /** Upkeep accumulator — kept apart from income so neither can hide the other. */
  upkeepAcc: number;
  /** True while food is exhausted and upkeep is owed; units bleed. */
  starving: boolean;
  /** Ticks since the last starvation bite. */
  starveTimer: number;
}

export interface PlayerInit {
  index: number;
  food?: number;
  timber?: number;
  silver?: number;
}

export class PlayerStore {
  private readonly items: Player[] = [];
  private readonly byIndex = new Map<number, Player>();

  add(init: PlayerInit): Player {
    if (this.byIndex.has(init.index)) throw new Error(`warfront-sim: duplicate player ${init.index}`);
    const player: Player = {
      index: init.index,
      food: init.food ?? START_FOOD,
      timber: init.timber ?? START_TIMBER,
      silver: init.silver ?? START_SILVER,
      pop: 0,
      popCap: 0,
      foodAcc: 0,
      timberAcc: 0,
      silverAcc: 0,
      upkeepAcc: 0,
      starving: false,
      starveTimer: 0,
    };
    this.items.push(player);
    this.items.sort((a, b) => a.index - b.index);
    this.byIndex.set(player.index, player);
    return player;
  }

  get(index: number): Player | undefined {
    return this.byIndex.get(index);
  }

  /** Players in ascending seat index. Do not mutate the array. */
  all(): readonly Player[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }

  hashInto(h: StateHasher): void {
    h.int(this.items.length);
    for (const p of this.items) {
      h.int(p.index).int(p.food).int(p.timber).int(p.silver).int(p.pop).int(p.popCap);
      h.int(p.foodAcc).int(p.timberAcc).int(p.silverAcc).int(p.upkeepAcc);
      h.bool(p.starving).int(p.starveTimer);
    }
  }
}

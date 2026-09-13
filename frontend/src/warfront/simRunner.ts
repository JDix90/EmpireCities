/**
 * Drives the deterministic simulation from the browser's frame clock.
 *
 * The simulation advances in whole ticks at exactly TICK_RATE and never sees wall-clock
 * time: this runner converts elapsed milliseconds into a whole number of `sim.step()`
 * calls and keeps the remainder for interpolation. That separation is the point — the
 * sim stays reproducible from a seed and a command log, while the renderer is free to
 * draw at whatever rate the display runs at.
 *
 * `advance` takes the elapsed time as an argument rather than reading a clock, so the
 * whole thing is testable without faking timers.
 */

import { FP_ONE, TICK_RATE, toIntFloor, type Sim } from '@borderfall/warfront-sim';

export const TICK_MS = 1000 / TICK_RATE;

/**
 * A frame that took longer than this many ticks is treated as a stall (a backgrounded
 * tab, a long GC) and the backlog is dropped rather than simulated all at once. Without
 * the cap, returning to a tab left open for a minute would try to run 900 ticks inside
 * one frame and lock the page.
 */
export const MAX_STEPS_PER_FRAME = 5;

/** A unit as the renderer sees it: world cells, fractional, display only. */
export interface UnitView {
  id: number;
  owner: number;
  /** Unit kind, so the plane can draw a villager differently from a ram. */
  kind: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  moving: boolean;
}

interface Snapshot {
  x: number;
  y: number;
}

export class SimRunner {
  readonly sim: Sim;
  private accumulatorMs = 0;
  private previous = new Map<number, Snapshot>();
  private steppedTicks = 0;

  constructor(sim: Sim) {
    this.sim = sim;
    this.snapshot();
  }

  /** Ticks actually simulated since construction — what a pacing readout should show. */
  get ticks(): number {
    return this.steppedTicks;
  }

  /** Fraction of the way from the previous tick to the current one, in [0, 1). */
  get alpha(): number {
    return this.accumulatorMs / TICK_MS;
  }

  private snapshot(): void {
    this.previous.clear();
    for (const unit of this.sim.entities.all()) this.previous.set(unit.id, { x: unit.x, y: unit.y });
  }

  /** Advances by a frame's worth of real time, stepping the sim a whole number of ticks. */
  advance(dtMs: number): number {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
    this.accumulatorMs += dtMs;
    let steps = 0;
    while (this.accumulatorMs >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.snapshot();
      this.sim.step();
      this.accumulatorMs -= TICK_MS;
      steps += 1;
      this.steppedTicks += 1;
    }
    // Dropped backlog: keep the sub-tick remainder so interpolation stays smooth, but
    // do not carry minutes of debt forward.
    if (this.accumulatorMs >= TICK_MS) this.accumulatorMs %= TICK_MS;
    return steps;
  }

  /**
   * Unit positions interpolated between the previous tick and the current one. Fixed
   * point is converted to a float HERE and nowhere upstream — the sim's own state stays
   * integral.
   */
  positions(): UnitView[] {
    const a = this.alpha;
    const out: UnitView[] = [];
    for (const unit of this.sim.entities.all()) {
      const prev = this.previous.get(unit.id);
      const px = prev ? prev.x : unit.x;
      const py = prev ? prev.y : unit.y;
      out.push({
        id: unit.id,
        owner: unit.owner,
        kind: unit.kind,
        hp: unit.hp,
        maxHp: unit.maxHp,
        x: (px + (unit.x - px) * a) / FP_ONE,
        y: (py + (unit.y - py) * a) / FP_ONE,
        moving: unit.moving,
      });
    }
    return out;
  }

  /** The cell a unit currently occupies, for panels and hit tests that want whole cells. */
  cellOf(unitId: number, gridWidth: number): number {
    const unit = this.sim.entities.get(unitId);
    if (!unit) return -1;
    return toIntFloor(unit.y) * gridWidth + toIntFloor(unit.x);
  }
}

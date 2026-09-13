import { assertFixed, assertInt, fpDiv, fpLength, fpMul, type Fixed } from './fixed';
import { Rng } from './rng';
import { StateHasher } from './hash';
import { EntityStore, type Unit } from './entities';
import { CommandQueue, validateCommand, type Command, type ScheduledCommand } from './commands';

/** Simulation ticks per second (decision 29). */
export const TICK_RATE = 15;
/** Live commands execute this many ticks after they are issued (decision 29). */
export const COMMAND_DELAY_TICKS = 2;

/** Starting state of a match, before any command. All numbers are integers; positions and speed are fixed. */
export interface Scenario {
  units: Array<{ owner: number; x: Fixed; y: Fixed; speed: Fixed }>;
}

export interface SimOptions {
  seed: number;
  scenario: Scenario;
}

/** A match, fully described: from this the final state is reproducible on any machine. */
export interface Replay {
  version: 1;
  seed: number;
  scenario: Scenario;
  commands: ScheduledCommand[];
}

function validateScenario(raw: Scenario): Scenario {
  if (!raw || !Array.isArray(raw.units)) throw new Error('warfront-sim: scenario.units must be an array');
  return {
    units: raw.units.map((u, i) => ({
      owner: assertInt(u.owner, `scenario.units[${i}].owner`),
      x: assertFixed(u.x, `scenario.units[${i}].x`),
      y: assertFixed(u.y, `scenario.units[${i}].y`),
      speed: assertFixed(u.speed, `scenario.units[${i}].speed`),
    })),
  };
}

/**
 * The deterministic core. State is: tick, RNG state, the entity store and the pending
 * command queue — and nothing else. `hash()` digests exactly that, so two sims that agree
 * on every hash agree on everything a replay can observe.
 */
export class Sim {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly rng: Rng;
  readonly entities = new EntityStore();
  readonly queue = new CommandQueue();
  private currentTick = 0;
  private readonly log: ScheduledCommand[] = [];

  constructor(opts: SimOptions) {
    this.seed = assertInt(opts.seed, 'seed');
    this.scenario = validateScenario(opts.scenario);
    this.rng = new Rng(this.seed);
    for (const u of this.scenario.units) this.entities.spawn(u);
  }

  /** Current tick. State is "as of the end of this tick". */
  get tick(): number {
    return this.currentTick;
  }

  /** Issues a live command: validated, stamped COMMAND_DELAY_TICKS ahead, logged. */
  issue(raw: Command): ScheduledCommand {
    return this.scheduleAt(raw, this.currentTick + COMMAND_DELAY_TICKS);
  }

  /**
   * Schedules a command for an explicit future tick (a replay, or a host that stamps
   * ticks itself). A tick at or before the current one is a bug, never silently
   * "as soon as possible": that would make the replay depend on arrival timing.
   */
  scheduleAt(raw: Command, tick: number): ScheduledCommand {
    assertInt(tick, 'command tick');
    if (tick <= this.currentTick) {
      throw new Error(`warfront-sim: cannot schedule a command for tick ${tick} at tick ${this.currentTick}`);
    }
    const command = validateCommand(raw);
    const entry = this.queue.schedule(command, tick);
    this.log.push(entry);
    return entry;
  }

  /** Advances one tick: applies that tick's commands, then moves every unit. */
  step(): void {
    const next = this.currentTick + 1;
    for (const entry of this.queue.take(next)) this.apply(entry.command);
    for (const unit of this.entities.all()) {
      if (unit.moving) this.moveUnit(unit);
    }
    this.currentTick = next;
  }

  /** Steps until `tick` (no-op if already there or past). */
  runTo(tick: number): void {
    assertInt(tick, 'tick');
    while (this.currentTick < tick) this.step();
  }

  /** Steps `n` times. */
  run(n: number): void {
    this.runTo(this.currentTick + assertInt(n, 'tick count'));
  }

  /** 16-hex-character digest of the complete state. */
  hash(): string {
    const h = new StateHasher();
    h.int(this.currentTick).word(this.rng.state);
    this.entities.hashInto(h);
    this.queue.hashInto(h);
    return h.digest();
  }

  /** Every command ever scheduled, in schedule order — with the seed and scenario, the whole match. */
  toReplay(): Replay {
    return {
      version: 1,
      seed: this.seed,
      scenario: this.scenario,
      commands: this.log.map((c) => ({ tick: c.tick, seq: c.seq, command: { ...c.command } })),
    };
  }

  /** Rebuilds a sim at tick 0 with every logged command pre-scheduled. */
  static fromReplay(replay: Replay): Sim {
    if (replay.version !== 1) throw new Error(`warfront-sim: unsupported replay version ${String(replay.version)}`);
    const sim = new Sim({ seed: replay.seed, scenario: replay.scenario });
    const ordered = [...replay.commands].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    for (const c of ordered) sim.scheduleAt(c.command, c.tick);
    return sim;
  }

  private apply(command: Command): void {
    switch (command.type) {
      case 'move': {
        // Commands for units that no longer exist are dropped deterministically: the
        // host and every replaying client see the same unit set at the same tick.
        const unit = this.entities.get(command.unit);
        if (!unit) return;
        unit.goalX = command.x;
        unit.goalY = command.y;
        unit.moving = unit.x !== command.x || unit.y !== command.y;
        unit.fieldId = -1;
        return;
      }
    }
  }

  /** Straight-line mover: step toward the goal by `speed`, snapping on arrival. */
  private moveUnit(unit: Unit): void {
    const dx = unit.goalX - unit.x;
    const dy = unit.goalY - unit.y;
    const dist = fpLength(dx, dy);
    if (dist <= unit.speed) {
      unit.x = unit.goalX;
      unit.y = unit.goalY;
      unit.moving = false;
      return;
    }
    // Unit direction vector, then scaled by speed: both operands stay inside int32.
    const nx = fpDiv(dx, dist);
    const ny = fpDiv(dy, dist);
    unit.x += fpMul(nx, unit.speed);
    unit.y += fpMul(ny, unit.speed);
  }
}

/** Runs a replay to `ticks` and returns the final hash — the golden-test primitive. */
export function replayHash(replay: Replay, ticks: number): string {
  const sim = Sim.fromReplay(replay);
  sim.runTo(ticks);
  return sim.hash();
}

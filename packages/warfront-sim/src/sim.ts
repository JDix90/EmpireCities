import { FP_HALF, FP_ONE, assertFixed, assertInt, fpDiv, fpLength, fpMul, toIntFloor, type Fixed } from './fixed';
import { TerrainGrid } from './terrain';
import { FlowFieldCache } from './flowField';
import { Rng } from './rng';
import { StateHasher } from './hash';
import { EntityStore, type Unit } from './entities';
import { CommandQueue, validateCommand, type Command, type ScheduledCommand } from './commands';

/** Simulation ticks per second (decision 29). */
export const TICK_RATE = 15;
/** Live commands execute this many ticks after they are issued (decision 29). */
export const COMMAND_DELAY_TICKS = 2;
/** How far (in cells, Chebyshev) a move onto impassable terrain is redirected to the nearest passable cell. */
export const NEAREST_PASSABLE_RADIUS = 12;
/** Waypoints a unit may pass in one tick (keeps the per-tick loop bounded). */
const MAX_WAYPOINTS_PER_TICK = 4;

/** Starting state of a match, before any command. All numbers are integers; positions and speed are fixed. */
export interface Scenario {
  units: Array<{ owner: number; x: Fixed; y: Fixed; speed: Fixed }>;
}

export interface SimOptions {
  seed: number;
  scenario: Scenario;
  /** Cell grid for flow-field movement. Without one, units walk straight lines. */
  terrain?: TerrainGrid | null;
}

/** A match, fully described: from this the final state is reproducible on any machine. */
export interface Replay {
  version: 1;
  seed: number;
  scenario: Scenario;
  commands: ScheduledCommand[];
  /** Identifies the terrain the match ran on; `fromReplay` refuses a different grid. */
  terrain_checksum?: string | null;
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
  readonly terrain: TerrainGrid | null;
  private readonly fields: FlowFieldCache | null;
  private currentTick = 0;
  private readonly log: ScheduledCommand[] = [];

  constructor(opts: SimOptions) {
    this.seed = assertInt(opts.seed, 'seed');
    this.scenario = validateScenario(opts.scenario);
    this.rng = new Rng(this.seed);
    this.terrain = opts.terrain ?? null;
    this.fields = this.terrain ? new FlowFieldCache(this.terrain) : null;
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
      terrain_checksum: this.terrain ? this.terrain.checksum() : null,
    };
  }

  /**
   * Rebuilds a sim at tick 0 with every logged command pre-scheduled. A replay that
   * names a terrain checksum must be given that exact grid.
   */
  static fromReplay(replay: Replay, terrain: TerrainGrid | null = null): Sim {
    if (replay.version !== 1) throw new Error(`warfront-sim: unsupported replay version ${String(replay.version)}`);
    const wanted = replay.terrain_checksum ?? null;
    const given = terrain ? terrain.checksum() : null;
    if (wanted !== given) {
      throw new Error(`warfront-sim: replay expects terrain ${String(wanted)} but was given ${String(given)}`);
    }
    const sim = new Sim({ seed: replay.seed, scenario: replay.scenario, terrain });
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
        let goalX = command.x;
        let goalY = command.y;
        let fieldKey = -1;
        const grid = this.terrain;
        if (grid) {
          // Clamp into the grid, then redirect an impassable target to the nearest
          // passable cell (same rule everywhere, so every host picks the same cell).
          let col = toIntFloor(command.x);
          let row = toIntFloor(command.y);
          let clamped = false;
          if (col < 0 || col >= grid.width) {
            col = col < 0 ? 0 : grid.width - 1;
            clamped = true;
          }
          if (row < 0 || row >= grid.height) {
            row = row < 0 ? 0 : grid.height - 1;
            clamped = true;
          }
          let target = grid.index(col, row);
          if (!grid.isPassable(target)) {
            target = grid.nearestPassable(target, NEAREST_PASSABLE_RADIUS);
            if (target < 0) return; // nothing walkable nearby: the order is dropped
            clamped = true;
          }
          if (clamped) {
            goalX = cellCentre(grid.colOf(target));
            goalY = cellCentre(grid.rowOf(target));
          }
          fieldKey = target;
        }
        unit.goalX = goalX;
        unit.goalY = goalY;
        unit.fieldKey = fieldKey;
        unit.moving = unit.x !== goalX || unit.y !== goalY;
        return;
      }
    }
  }

  private moveUnit(unit: Unit): void {
    if (this.terrain && this.fields && unit.fieldKey >= 0) this.moveOnField(unit, this.terrain, this.fields);
    else this.moveStraight(unit);
  }

  /** Straight-line mover: step toward the goal by `speed`, snapping on arrival. */
  private moveStraight(unit: Unit): void {
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

  /**
   * Flow-field mover: walk toward the centre of the next cell the field points at,
   * and straight to the goal point once inside the target cell. A tick's movement
   * budget carries across waypoints so corners do not slow the unit down.
   */
  private moveOnField(unit: Unit, grid: TerrainGrid, fields: FlowFieldCache): void {
    const field = fields.get(unit.fieldKey);
    let budget = unit.speed;
    for (let hop = 0; hop < MAX_WAYPOINTS_PER_TICK && budget > 0 && unit.moving; hop++) {
      const col = toIntFloor(unit.x);
      const row = toIntFloor(unit.y);
      if (!grid.inBounds(col, row)) {
        unit.moving = false;
        return;
      }
      const cur = grid.index(col, row);
      let wx: Fixed;
      let wy: Fixed;
      let atTargetCell = false;
      if (cur === field.target) {
        wx = unit.goalX;
        wy = unit.goalY;
        atTargetCell = true;
      } else {
        field.ensure(cur);
        const next = field.next[cur];
        if (next < 0) {
          unit.moving = false; // unreachable from here
          return;
        }
        wx = cellCentre(grid.colOf(next));
        wy = cellCentre(grid.rowOf(next));
      }
      const dx = wx - unit.x;
      const dy = wy - unit.y;
      const dist = fpLength(dx, dy);
      if (dist <= budget) {
        unit.x = wx;
        unit.y = wy;
        budget -= dist;
        if (atTargetCell) unit.moving = false;
        continue;
      }
      const nx = fpDiv(dx, dist);
      const ny = fpDiv(dy, dist);
      unit.x += fpMul(nx, budget);
      unit.y += fpMul(ny, budget);
      budget = 0;
    }
  }
}

/** Fixed position of the centre of cell column/row `i`. */
export function cellCentre(i: number): Fixed {
  return i * FP_ONE + FP_HALF;
}

/** Runs a replay to `ticks` and returns the final hash — the golden-test primitive. */
export function replayHash(replay: Replay, ticks: number, terrain: TerrainGrid | null = null): string {
  const sim = Sim.fromReplay(replay, terrain);
  sim.runTo(ticks);
  return sim.hash();
}

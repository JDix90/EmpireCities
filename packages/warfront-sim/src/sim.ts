import { FP_HALF, FP_ONE, assertFixed, assertInt, fpDiv, fpLength, fpMul, idiv, toIntFloor, type Fixed } from './fixed';
import { COMMAND_DELAY_TICKS } from './constants';
import { TerrainGrid } from './terrain';
import { FlowFieldCache } from './flowField';
import { Rng } from './rng';
import { StateHasher } from './hash';
import { EntityStore, type Unit } from './entities';
import { CommandQueue, validateCommand, type Command, type ScheduledCommand } from './commands';
import { BuildingStore, type Building } from './buildings';
import { PlayerStore } from './players';
import { stepEconomy, type EconomyContext } from './economy';
import {
  BUILDER_SLOTS,
  BUILDING_SPECS,
  BuildingKind,
  TICKS_PER_MINUTE,
  TRAINS_AT,
  UNIT_SPECS,
  UnitKind,
  type BuildingKindValue,
  type UnitKindValue,
} from './rules';

// Re-exported so every existing importer of `sim` keeps working; they live in
// constants.ts so the rules and economy modules can read them without a cycle.
export { TICK_RATE, COMMAND_DELAY_TICKS } from './constants';
/** How far (in cells, Chebyshev) a move onto impassable terrain is redirected to the nearest passable cell. */
export const NEAREST_PASSABLE_RADIUS = 12;
/** Waypoints a unit may pass in one tick (keeps the per-tick loop bounded). */
const MAX_WAYPOINTS_PER_TICK = 4;

/** Starting state of a match, before any command. All numbers are integers; positions and speed are fixed. */
export interface Scenario {
  units: Array<{ owner: number; x: Fixed; y: Fixed; speed: Fixed; kind?: UnitKindValue }>;
  /** Seats in the match. Omit for a movement-only scenario with no economy. */
  players?: Array<{ index: number; food?: number; timber?: number; silver?: number }>;
  /** Buildings standing at the start — a seat, normally. Requires terrain. */
  buildings?: Array<{ owner: number; kind: BuildingKindValue; cell: number }>;
}

export interface SimOptions {
  seed: number;
  scenario: Scenario;
  /** Cell grid for flow-field movement. Without one, units walk straight lines. */
  terrain?: TerrainGrid | null;
}

/**
 * The replay format version.
 *
 * Bumped to 2 in step 3. The simulation state grew an economy — resources, buildings,
 * population, upkeep — and every one of those fields is hashed, so a version 1 replay
 * REPLAYS to a different hash than it recorded. Refusing it outright is the whole point
 * of this package: a replay that silently disagrees with itself is the failure mode the
 * determinism rules exist to prevent, and a loud error beats a quiet divergence.
 */
export const REPLAY_VERSION = 2;

/** A match, fully described: from this the final state is reproducible on any machine. */
export interface Replay {
  version: number;
  seed: number;
  scenario: Scenario;
  commands: ScheduledCommand[];
  /** Identifies the terrain the match ran on; `fromReplay` refuses a different grid. */
  terrain_checksum?: string | null;
}

function validateScenario(raw: Scenario): Scenario {
  if (!raw || !Array.isArray(raw.units)) throw new Error('warfront-sim: scenario.units must be an array');
  const scenario: Scenario = {
    units: raw.units.map((u, i) => ({
      owner: assertInt(u.owner, `scenario.units[${i}].owner`),
      x: assertFixed(u.x, `scenario.units[${i}].x`),
      y: assertFixed(u.y, `scenario.units[${i}].y`),
      speed: assertFixed(u.speed, `scenario.units[${i}].speed`),
      ...(u.kind === undefined ? {} : { kind: assertInt(u.kind, `scenario.units[${i}].kind`) as UnitKindValue }),
    })),
  };
  if (raw.players) {
    scenario.players = raw.players.map((p, i) => ({
      index: assertInt(p.index, `scenario.players[${i}].index`),
      ...(p.food === undefined ? {} : { food: assertInt(p.food, `scenario.players[${i}].food`) }),
      ...(p.timber === undefined ? {} : { timber: assertInt(p.timber, `scenario.players[${i}].timber`) }),
      ...(p.silver === undefined ? {} : { silver: assertInt(p.silver, `scenario.players[${i}].silver`) }),
    }));
  }
  if (raw.buildings) {
    scenario.buildings = raw.buildings.map((b, i) => ({
      owner: assertInt(b.owner, `scenario.buildings[${i}].owner`),
      kind: assertInt(b.kind, `scenario.buildings[${i}].kind`) as BuildingKindValue,
      cell: assertInt(b.cell, `scenario.buildings[${i}].cell`),
    }));
  }
  return scenario;
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
  readonly players = new PlayerStore();
  readonly buildings = new BuildingStore();
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

    // The economy is opt-in: a scenario with no seats is a movement-only scenario, which
    // is what step 1 and step 2 replays are. It needs a grid, because buildings live on
    // cells and a cell index means nothing without one.
    if (this.scenario.players?.length || this.scenario.buildings?.length) {
      if (!this.terrain) throw new Error('warfront-sim: an economy scenario needs terrain');
      for (const p of this.scenario.players ?? []) this.players.add(p);
      for (const b of this.scenario.buildings ?? []) {
        if (!this.players.get(b.owner)) throw new Error(`warfront-sim: building for unknown seat ${b.owner}`);
        this.buildings.place({ ...b, complete: true });
      }
    }
  }

  /** True when this match has an economy (seats, resources, buildings). */
  get hasEconomy(): boolean {
    return this.players.size > 0;
  }

  private economyContext(): EconomyContext {
    return { players: this.players, buildings: this.buildings, entities: this.entities, grid: this.terrain! };
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

  /**
   * Advances one tick: this tick's commands, then movement, then the economy.
   *
   * Movement before the economy is deliberate: a villager that arrives at its farm this
   * tick starts earning this tick, rather than idling for one.
   */
  step(): void {
    const next = this.currentTick + 1;
    for (const entry of this.queue.take(next)) this.apply(entry.command);
    // Snapshot: a unit killed by starvation must not be stepped after it dies.
    for (const unit of [...this.entities.all()]) {
      if (unit.moving) this.moveUnit(unit);
    }
    if (this.hasEconomy) {
      stepEconomy(
        this.economyContext(),
        (building, kind) => this.spawnTrained(building, kind as UnitKindValue),
        (unit) => this.killUnit(unit),
      );
    }
    this.currentTick = next;
  }

  /** Places a freshly trained unit at its building, ready to be given a job. */
  private spawnTrained(building: Building, kind: UnitKindValue): void {
    const grid = this.terrain!;
    const spec = UNIT_SPECS[kind];
    this.entities.spawn({
      owner: building.owner,
      kind,
      x: cellCentre(grid.colOf(building.cell)),
      y: cellCentre(grid.rowOf(building.cell)),
      // Cells per minute → fixed cells per tick, through idiv so it is exact: the table
      // is per-minute so it stays readable, and the conversion happens once here rather
      // than every tick. A unit slower than one fixed step a tick would never move, so
      // the floor is 1.
      speed: Math.max(1, idiv(spec.speedPerMinute * FP_ONE, TICKS_PER_MINUTE)),
    });
  }

  /** Removes a unit and every reference to it, so nothing points at a corpse. */
  private killUnit(unit: Unit): void {
    for (const building of this.buildings.all()) {
      const index = building.workers.indexOf(unit.id);
      if (index >= 0) building.workers.splice(index, 1);
    }
    this.entities.remove(unit.id);
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
    this.players.hashInto(h);
    this.buildings.hashInto(h);
    this.queue.hashInto(h);
    return h.digest();
  }

  /** Every command ever scheduled, in schedule order — with the seed and scenario, the whole match. */
  toReplay(): Replay {
    return {
      version: REPLAY_VERSION,
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
    if (replay.version !== REPLAY_VERSION) {
      throw new Error(
        `warfront-sim: unsupported replay version ${String(replay.version)} (this build records and replays version ${REPLAY_VERSION})`,
      );
    }
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

      case 'train': {
        const building = this.buildings.get(command.building);
        if (!building || !building.complete) return;
        const player = this.players.get(building.owner);
        if (!player) return;
        const kind = command.unit as UnitKindValue;
        // Only what this building trains, so a command cannot conjure a unit from a farm.
        if (!TRAINS_AT[building.kind]?.includes(kind)) return;
        const spec = UNIT_SPECS[kind];
        if (!spec) return;
        if (player.food < spec.food || player.timber < spec.timber || player.silver < spec.silver) return;
        player.food -= spec.food;
        player.timber -= spec.timber;
        player.silver -= spec.silver;
        building.queue.push(kind);
        if (building.queue.length === 1) building.queueRemaining = spec.trainTicks;
        return;
      }

      case 'assign': {
        const unit = this.entities.get(command.unit);
        // Rule II is about villagers. A soldier cannot be parked on a farm.
        if (!unit || unit.kind !== UnitKind.Villager) return;
        if (command.building < 0) {
          this.unassign(unit);
          return;
        }
        const building = this.buildings.get(command.building);
        if (!building || building.owner !== unit.owner) return;
        const spec = BUILDING_SPECS[building.kind];
        if (!spec) return;
        const capacity = building.complete ? spec.workerSlots : BUILDER_SLOTS;
        if (capacity === 0) return;
        if (building.workers.length >= capacity && !building.workers.includes(unit.id)) return;
        this.unassign(unit);
        // Ascending id: the worker list is hashed, so its order must not depend on the
        // order commands happened to arrive in.
        building.workers.push(unit.id);
        building.workers.sort((a, b) => a - b);
        unit.job = building.id;
        // Assigned, not clicked: the villager takes itself to the job.
        this.orderToCell(unit, building.cell);
        return;
      }

      case 'build': {
        const grid = this.terrain;
        if (!grid) return;
        const unit = this.entities.get(command.unit);
        if (!unit || unit.kind !== UnitKind.Villager) return;
        const player = this.players.get(unit.owner);
        if (!player) return;
        const kind = command.kind as BuildingKindValue;
        const spec = BUILDING_SPECS[kind];
        // A seat is planted by colonising, not built — that is rule I, and it arrives
        // with the next step.
        if (!spec || kind === BuildingKind.Seat) return;
        if (command.cell < 0 || command.cell >= grid.size) return;
        if (!grid.isPassable(command.cell)) return;
        if (this.buildings.atCell(command.cell)) return;
        // Rule IV feeding rule II: the terrain decides what can stand here. A farm needs
        // plains, a lumber camp forest, a mine hills — which is why WHERE you settle
        // decides WHAT you can build.
        if (spec.biomes.length > 0 && !spec.biomes.includes(grid.biome(command.cell))) return;
        if (player.timber < spec.timber || player.silver < spec.silver) return;
        player.timber -= spec.timber;
        player.silver -= spec.silver;
        const building = this.buildings.place({ kind, owner: unit.owner, cell: command.cell });
        this.unassign(unit);
        building.workers.push(unit.id);
        unit.job = building.id;
        this.orderToCell(unit, command.cell);
        return;
      }
    }
  }

  /** Takes a unit off whatever job it holds. The only way off a job is onto another. */
  private unassign(unit: Unit): void {
    if (unit.job < 0) return;
    const previous = this.buildings.get(unit.job);
    if (previous) {
      const index = previous.workers.indexOf(unit.id);
      if (index >= 0) previous.workers.splice(index, 1);
    }
    unit.job = -1;
  }

  /** Walks a unit to the centre of a cell, using the same pathing a move order uses. */
  private orderToCell(unit: Unit, cell: number): void {
    const grid = this.terrain;
    if (!grid) return;
    const goalX = cellCentre(grid.colOf(cell));
    const goalY = cellCentre(grid.rowOf(cell));
    unit.goalX = goalX;
    unit.goalY = goalY;
    unit.fieldKey = grid.isPassable(cell) ? cell : -1;
    unit.moving = unit.x !== goalX || unit.y !== goalY;
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

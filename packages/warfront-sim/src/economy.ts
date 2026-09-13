import { idiv, toIntFloor } from './fixed';
import type { EntityStore, Unit } from './entities';
import type { Building, BuildingStore } from './buildings';
import type { Player, PlayerStore } from './players';
import type { TerrainGrid } from './terrain';
import {
  BUILDING_SPECS,
  Resource,
  STARVATION_INTERVAL_TICKS,
  STARVATION_PERCENT_PER_INTERVAL,
  TICKS_PER_MINUTE,
  UNIT_SPECS,
  WORK_RADIUS_CELLS,
} from './rules';

/**
 * The economy tick: construction, gathering, training, upkeep, population.
 *
 * Run in a FIXED order every tick, because the order is observable. Gathering before
 * upkeep means a farm can feed the villager working it within the same tick; training
 * before upkeep means a unit that pops this tick eats from this tick. Changing the order
 * changes the numbers, so it is not incidental — it is part of the rules.
 *
 * All arithmetic is integer. Per-minute rates accumulate and flush whole units at
 * TICKS_PER_MINUTE (see players.ts), so 900 ticks of one farmer is exactly 12 food on
 * every machine.
 */

export interface EconomyContext {
  players: PlayerStore;
  buildings: BuildingStore;
  entities: EntityStore;
  grid: TerrainGrid;
  /** Called when a unit dies, so the caller can clean up selections and jobs. */
  onUnitRemoved?: (unitId: number) => void;
}

/** Chebyshev distance in cells between a unit and a cell index. */
export function unitCellDistance(unit: Unit, cell: number, width: number): number {
  const ucol = toIntFloor(unit.x);
  const urow = toIntFloor(unit.y);
  const bcol = cell % width;
  const brow = idiv(cell, width);
  const dc = ucol - bcol;
  const dr = urow - brow;
  return Math.max(dc < 0 ? -dc : dc, dr < 0 ? -dr : dr);
}

/** True when a unit is close enough to its building to work it. */
export function isAtWork(unit: Unit, building: Building, width: number): boolean {
  return unitCellDistance(unit, building.cell, width) <= WORK_RADIUS_CELLS;
}

/**
 * Workers of a building that are actually present. Walking to the site costs real time,
 * which is what makes WHERE a building goes a decision rather than a formality.
 */
function presentWorkers(building: Building, entities: EntityStore, width: number): number {
  let present = 0;
  for (const id of building.workers) {
    const unit = entities.get(id);
    if (unit && unit.owner === building.owner && isAtWork(unit, building, width)) present += 1;
  }
  return present;
}

/** Builders finish a construction; two builders halve the time, as the brief specifies. */
function stepConstruction(ctx: EconomyContext): void {
  const width = ctx.grid.width;
  for (const building of ctx.buildings.all()) {
    if (building.complete) continue;
    const spec = BUILDING_SPECS[building.kind];
    if (!spec) continue;
    const builders = presentWorkers(building, ctx.entities, width);
    if (builders === 0) continue;
    building.progress += builders;
    if (building.progress >= spec.buildTicks) {
      building.progress = spec.buildTicks;
      building.complete = true;
      building.hp = spec.hp;
      // Builders are not gatherers: a finished building that cannot be worked releases
      // them, rather than leaving villagers standing idle at a house. Clear the unit's
      // job too — a unit still pointing at a building whose worker list no longer holds
      // it is inconsistent state, and every later rule that reads one or the other would
      // disagree about whether that villager is employed.
      if (spec.workerSlots === 0) {
        for (const id of building.workers) {
          const worker = ctx.entities.get(id);
          if (worker && worker.job === building.id) worker.job = -1;
        }
        building.workers = [];
      }
    } else {
      // A half-built building is half as tough. Integer, so it never drifts.
      building.hp = 1 + idiv((spec.hp - 1) * building.progress, spec.buildTicks);
    }
  }
}

/** Completed producing buildings pay their owner for every worker standing on them. */
function stepGathering(ctx: EconomyContext): void {
  const width = ctx.grid.width;
  for (const building of ctx.buildings.all()) {
    if (!building.complete) continue;
    const spec = BUILDING_SPECS[building.kind];
    if (!spec || spec.produces === Resource.None) continue;
    const player = ctx.players.get(building.owner);
    if (!player) continue;
    const workers = presentWorkers(building, ctx.entities, width);
    if (workers === 0) continue;
    const perMinute = spec.yieldPerMinute * workers;
    switch (spec.produces) {
      case Resource.Food:
        player.foodAcc += perMinute;
        break;
      case Resource.Timber:
        player.timberAcc += perMinute;
        break;
      case Resource.Silver:
        player.silverAcc += perMinute;
        break;
    }
  }
  for (const player of ctx.players.all()) {
    player.food += flush(player, 'foodAcc');
    player.timber += flush(player, 'timberAcc');
    player.silver += flush(player, 'silverAcc');
  }
}

/** Takes whole units out of an accumulator, leaving the remainder. Exact, no drift. */
function flush(player: Player, key: 'foodAcc' | 'timberAcc' | 'silverAcc'): number {
  const acc = player[key];
  if (acc < TICKS_PER_MINUTE) return 0;
  const whole = idiv(acc, TICKS_PER_MINUTE);
  player[key] = acc - whole * TICKS_PER_MINUTE;
  return whole;
}

/** The seat's training queue. Costs were paid on enqueue; this only spends time. */
function stepTraining(ctx: EconomyContext, spawn: (b: Building, kind: number) => void): void {
  for (const building of ctx.buildings.all()) {
    if (!building.complete || building.queue.length === 0) continue;
    const player = ctx.players.get(building.owner);
    if (!player) continue;
    const kind = building.queue[0];
    const spec = UNIT_SPECS[kind];
    if (!spec) {
      building.queue.shift();
      continue;
    }
    if (building.queueRemaining > 0) {
      building.queueRemaining -= 1;
      if (building.queueRemaining > 0) continue;
    }
    // Population-blocked: the unit is trained but has nowhere to live, so it waits at
    // the gate rather than being lost or silently exceeding the cap.
    if (player.pop + spec.pop > player.popCap) continue;
    building.queue.shift();
    building.queueRemaining = building.queue.length > 0 ? (UNIT_SPECS[building.queue[0]]?.trainTicks ?? 0) : 0;
    spawn(building, kind);
  }
}

/** Villagers and soldiers eat (decision 25). Starvation bleeds like attrition. */
function stepUpkeep(ctx: EconomyContext, kill: (unit: Unit) => void): void {
  const upkeepByPlayer = new Map<number, number>();
  for (const unit of ctx.entities.all()) {
    const spec = UNIT_SPECS[unit.kind];
    if (!spec) continue;
    upkeepByPlayer.set(unit.owner, (upkeepByPlayer.get(unit.owner) ?? 0) + spec.upkeep);
  }

  for (const player of ctx.players.all()) {
    const perMinute = upkeepByPlayer.get(player.index) ?? 0;
    player.upkeepAcc += perMinute;
    if (player.upkeepAcc >= TICKS_PER_MINUTE) {
      const owed = idiv(player.upkeepAcc, TICKS_PER_MINUTE);
      player.upkeepAcc -= owed * TICKS_PER_MINUTE;
      player.food -= owed;
      if (player.food < 0) player.food = 0;
    }
    player.starving = player.food <= 0 && perMinute > 0;

    if (!player.starving) {
      player.starveTimer = 0;
      continue;
    }
    player.starveTimer += 1;
    if (player.starveTimer < STARVATION_INTERVAL_TICKS) continue;
    player.starveTimer = 0;
    // Bite every unit of a starving empire. Integer percentage, minimum one point, so a
    // small unit still dies eventually rather than rounding down to immortal.
    for (const unit of [...ctx.entities.all()]) {
      if (unit.owner !== player.index) continue;
      const bite = Math.max(1, idiv(unit.maxHp * STARVATION_PERCENT_PER_INTERVAL, 100));
      unit.hp -= bite;
      if (unit.hp <= 0) kill(unit);
    }
  }
}

/** Population used and capped, recomputed from live state so it cannot drift. */
function stepPopulation(ctx: EconomyContext): void {
  const used = new Map<number, number>();
  for (const unit of ctx.entities.all()) {
    const spec = UNIT_SPECS[unit.kind];
    if (!spec) continue;
    used.set(unit.owner, (used.get(unit.owner) ?? 0) + spec.pop);
  }
  const cap = new Map<number, number>();
  for (const building of ctx.buildings.all()) {
    if (!building.complete) continue;
    const spec = BUILDING_SPECS[building.kind];
    if (!spec || spec.pop === 0) continue;
    cap.set(building.owner, (cap.get(building.owner) ?? 0) + spec.pop);
  }
  for (const player of ctx.players.all()) {
    player.pop = used.get(player.index) ?? 0;
    player.popCap = cap.get(player.index) ?? 0;
  }
}

/**
 * One economy tick, in the fixed order described at the top of this file.
 * `spawn` and `kill` are injected because creating and destroying units is the
 * simulation's job, not the economy's.
 */
export function stepEconomy(
  ctx: EconomyContext,
  spawn: (building: Building, kind: number) => void,
  kill: (unit: Unit) => void,
): void {
  stepConstruction(ctx);
  stepGathering(ctx);
  stepTraining(ctx, spawn);
  stepUpkeep(ctx, kill);
  stepPopulation(ctx);
}

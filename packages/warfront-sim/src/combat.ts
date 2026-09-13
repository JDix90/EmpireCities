import { FP_HALF, FP_ONE, idiv, toIntFloor } from './fixed';
import type { EntityStore, Unit } from './entities';
import type { Building, BuildingStore } from './buildings';
import type { TerrainGrid } from './terrain';
import {
  BUILDING_COMBAT,
  COMBAT_SPECS,
  DISEMBARK_DAMAGE_PERCENT,
  HIGH_GROUND_ARCHER_RANGE_BONUS,
  UnitKind,
  damageMultiplier,
} from './rules';

/**
 * Combat: the triangle, the siege engine, and the tower that fires on its own.
 *
 * Auto-attack, not ordered attack. Anything in range of an enemy strikes it on its own
 * cadence, which is what lets rule VI work at all — raiders reach your villagers and the
 * fighting starts without anyone clicking. There are no formations, no morale and no
 * healing, exactly as the brief specifies for the slice.
 *
 * Determinism: units are visited in ascending id, targeting is nearest-first with the
 * lowest id breaking ties, and every number is an integer. No distance is ever square
 * rooted — comparisons are done on squared distances, which stay well inside a double's
 * exact-integer range at this world size.
 *
 * A cooldown is set to `interval - 1` after a strike, so the PERIOD is exactly `interval`
 * ticks: the tick that struck is the first of the interval, not an extra one in front of
 * it. That is what makes the brief's "8/s at 6 cells" literally 8 damage in 15 ticks.
 */

export interface CombatContext {
  entities: EntityStore;
  buildings: BuildingStore;
  grid: TerrainGrid;
}

/** Fixed position of the centre of a cell. */
function centreX(grid: TerrainGrid, cell: number): number {
  return grid.colOf(cell) * FP_ONE + FP_HALF;
}

function centreY(grid: TerrainGrid, cell: number): number {
  return grid.rowOf(cell) * FP_ONE + FP_HALF;
}

/** Squared distance in fixed units. Exact: (2^16 × 1000)^2 is far below 2^53. */
function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * A unit's reach this tick, in fixed units, including any terrain bonus.
 *
 * Rule IV modifies the triangle rather than adding to it: an archer on high ground
 * reaches one cell further, and that is the whole of the terrain rule in combat.
 */
export function effectiveRange(unit: Unit, grid: TerrainGrid): number {
  const spec = COMBAT_SPECS[unit.kind];
  if (!spec) return 0;
  let cells = spec.range;
  if (unit.kind === UnitKind.Archer && onHighGround(unit, grid)) cells += HIGH_GROUND_ARCHER_RANGE_BONUS;
  return cells * FP_ONE;
}

function onHighGround(unit: Unit, grid: TerrainGrid): boolean {
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  return grid.inBounds(col, row) && grid.tier(grid.index(col, row)) === 1;
}

/** Nearest enemy unit within reach of a point, or null. Lowest id breaks a tie. */
function nearestEnemyUnit(
  ctx: CombatContext,
  owner: number,
  x: number,
  y: number,
  rangeFixed: number,
): Unit | null {
  const limit = rangeFixed * rangeFixed;
  let best: Unit | null = null;
  let bestDist = 0;
  for (const other of ctx.entities.all()) {
    if (other.owner === owner || other.hp <= 0) continue;
    // A convoy is unreachable from the shore as well as from the sea: its units still
    // carry the coordinates they sailed from, so without this a tower would keep firing
    // at a boat that left ten seconds ago.
    if (other.convoy >= 0) continue;
    const d = distSq(x, y, other.x, other.y);
    if (d > limit) continue;
    // Strictly nearer only: the store iterates in ascending id, so an equal distance
    // leaves the lower id in place and the tie is broken without comparing ids.
    if (best === null || d < bestDist) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Rule V's opposed landing, as a percentage multiplier.
 *
 * A unit still coming ashore over somebody else's beach takes double. Applied to the
 * DEFENDER of a strike rather than the attacker, because it is a property of the unit
 * being hit — everyone shooting at it gets the benefit, which is what makes landing into
 * a garrison the mistake the brief says it is.
 */
export function landingPenalty(target: Unit): number {
  return target.disembarkTimer > 0 ? DISEMBARK_DAMAGE_PERCENT : 100;
}

/** Nearest enemy building within reach of a point, or null. Lowest id breaks a tie. */
function nearestEnemyBuilding(
  ctx: CombatContext,
  owner: number,
  x: number,
  y: number,
  rangeFixed: number,
): Building | null {
  const limit = rangeFixed * rangeFixed;
  let best: Building | null = null;
  let bestDist = 0;
  for (const building of ctx.buildings.all()) {
    if (building.owner === owner) continue;
    const d = distSq(x, y, centreX(ctx.grid, building.cell), centreY(ctx.grid, building.cell));
    if (d > limit) continue;
    if (best === null || d < bestDist) {
      best = building;
      bestDist = d;
    }
  }
  return best;
}

/**
 * One combat tick.
 *
 * `hurtUnit` and `hurtBuilding` are injected because destroying things is the
 * simulation's job: it owns the cleanup that has to follow a death — worker lists, jobs,
 * province ownership, raid bookkeeping. They are told the attacker's OWNER rather than
 * the attacker itself, because a tower has no unit behind it and because the owner is
 * the only thing the consequences depend on.
 */
export function stepCombat(
  ctx: CombatContext,
  hurtUnit: (target: Unit, amount: number, attackerOwner: number) => void,
  hurtBuilding: (target: Building, amount: number, attackerOwner: number) => void,
): void {
  // A snapshot, because a strike can remove a unit from the store mid-loop.
  for (const unit of [...ctx.entities.all()]) {
    if (unit.hp <= 0) continue;
    // Rule V: "a convoy at sea cannot be attacked — the fight is always on the shore." It
    // cannot attack either; a unit in transit is not on the grid in any direction.
    if (unit.convoy >= 0) continue;
    const spec = COMBAT_SPECS[unit.kind];
    // Villagers and scouts have no entry: they do not fight. Rule VI wants villagers to
    // die to raids, and a villager that fought back would make a robbery a skirmish.
    if (!spec) continue;
    if (unit.cooldown > 0) {
      unit.cooldown -= 1;
      continue;
    }
    if (spec.siege) {
      // A siege engine is harmless to units and is the only thing that reduces a seat in
      // reasonable time — which is why rule VII's marching camp has to come before it.
      const target = nearestEnemyBuilding(ctx, unit.owner, unit.x, unit.y, spec.range * FP_ONE);
      if (!target) continue;
      hurtBuilding(target, spec.damage, unit.owner);
      unit.cooldown = spec.interval - 1;
      continue;
    }
    const target = nearestEnemyUnit(ctx, unit.owner, unit.x, unit.y, effectiveRange(unit, ctx.grid));
    if (!target) continue;
    // The triangle is a percentage so the arithmetic stays integer; idiv floors it, and
    // the landing penalty multiplies on top of it — rule V's "20s at half armour", which
    // in a roster with no armour stat is double damage taken.
    hurtUnit(target, idiv(spec.damage * damageMultiplier(unit.kind, target.kind) * landingPenalty(target), 10000), unit.owner);
    unit.cooldown = spec.interval - 1;
  }

  // Towers fire on their own — rule III, and the reason a seat is not free to walk up to.
  for (const building of [...ctx.buildings.all()]) {
    if (!building.complete) continue;
    const spec = BUILDING_COMBAT[building.kind];
    if (!spec) continue;
    if (building.cooldown > 0) {
      building.cooldown -= 1;
      continue;
    }
    const x = centreX(ctx.grid, building.cell);
    const y = centreY(ctx.grid, building.cell);
    const target = nearestEnemyUnit(ctx, building.owner, x, y, spec.range * FP_ONE);
    if (!target) continue;
    hurtUnit(target, spec.damage, building.owner);
    building.cooldown = spec.interval - 1;
  }
}

import { chebyshevCells } from './geometry';
import {
  ATTRITION_IN_NEUTRAL,
  ATTRITION_INTERVAL_TICKS,
  ATTRITION_PERCENT_PER_INTERVAL,
  BUILDING_SPECS,
  BuildingKind,
  CAMP_MIN_SOLDIERS,
  CAMP_MUSTER_CELLS,
  CAMP_RADIUS_CELLS,
  COMBAT_SPECS,
} from './rules';
import { idiv, toIntFloor } from './fixed';
import type { BuildingStore } from './buildings';
import type { EntityStore, Unit } from './entities';
import type { ProvinceStore } from './provinces';
import type { TerrainGrid } from './terrain';

/**
 * Rule VII: attrition, and the marching camp that answers it.
 *
 * The rule the brief leans on to make a free-for-all survivable. Elimination is meant to
 * be slow — "capital seats are fortresses, attrition punishes deep invasions" — so the
 * cost of taking somebody's province is not only the fight at the end of the march but
 * the march itself. An army that sits in enemy land indefinitely is the failure mode this
 * exists to price.
 *
 * Deliberately separate from starvation, which it resembles: that is one clock per PLAYER
 * and this is one per UNIT, because an empire starves as a whole and an army bleeds only
 * where it happens to be standing.
 */

export interface AttritionContext {
  entities: EntityStore;
  buildings: BuildingStore;
  provinces: ProvinceStore;
  grid: TerrainGrid;
}

/**
 * Whether this unit is army for rule VII's purposes.
 *
 * "Your ARMY bleeds", and the roster draws the line for us: a unit with a combat entry
 * fights, and a villager or a scout does not. That split matters more than it looks.
 * Rule I requires villagers to walk into neutral provinces and plant seats there, and
 * rule V requires a scout to sit on somebody else's beach watching a lane — both of them
 * jobs that attrition would turn into a death march if the bleed hit everything with legs.
 */
function bleeds(unit: Unit): boolean {
  return COMBAT_SPECS[unit.kind] !== undefined;
}

/** A camp of your own, standing and finished, within its radius of a point. */
function underCamp(ctx: AttritionContext, owner: number, cell: number): boolean {
  for (const building of ctx.buildings.all()) {
    if (building.kind !== BuildingKind.Camp || building.owner !== owner) continue;
    // An unfinished camp shelters nobody: the thirty seconds of raising it are three
    // bleeds, which is what stops a camp being a free answer to the rule.
    if (!building.complete) continue;
    if (chebyshevCells(ctx.grid, building.cell, cell) <= CAMP_RADIUS_CELLS) return true;
  }
  return false;
}

/**
 * Whether a unit standing here is exposed.
 *
 * Ground you hold is safe, your own camp is safe, and — under the reading the constant
 * selects — neutral ground may be either. See `ATTRITION_IN_NEUTRAL` for why the brief
 * supports both and why this is a switch rather than a decision baked into the code.
 */
export function exposedAt(ctx: AttritionContext, owner: number, cell: number): boolean {
  const provinceIndex = ctx.grid.owner(cell);
  const province = ctx.provinces.get(provinceIndex);
  const holder = province?.owner ?? 0;
  if (holder === owner) return false;
  if (holder === 0 && !ATTRITION_IN_NEUTRAL) return false;
  return !underCamp(ctx, owner, cell);
}

/**
 * Soldiers standing by an unfinished camp raise it.
 *
 * A camp completes on the muster that is still there, not on assigned labour: nobody is
 * ever assigned to one, and rule II's worker lists are for villagers. That is also what
 * gives the defender a second answer to it — driving the soldiers off stalls the camp at
 * whatever fraction it had reached, so a camp is only as safe as the army holding the
 * ground it stands on.
 *
 * Progress advances by one tick per tick regardless of how many soldiers are over the
 * muster, deliberately: the brief prices a camp at "five+ soldiers", and letting twenty
 * raise it four times faster would make the answer to attrition "bring a bigger army",
 * which is the opposite of what rule VII is for.
 */
export function stepCamps(ctx: AttritionContext): void {
  for (const building of ctx.buildings.all()) {
    if (building.kind !== BuildingKind.Camp || building.complete) continue;
    const spec = BUILDING_SPECS[BuildingKind.Camp];
    if (musterAt(ctx, building.owner, building.cell) < CAMP_MIN_SOLDIERS) continue;
    building.progress += 1;
    if (building.progress >= spec.buildTicks) {
      building.progress = spec.buildTicks;
      building.complete = true;
      building.hp = spec.hp;
    } else {
      // Half-raised is half as tough, the same arithmetic every other construction uses.
      building.hp = 1 + idiv((spec.hp - 1) * building.progress, spec.buildTicks);
    }
  }
}

/** Own soldiers within muster range of a point. */
export function musterAt(ctx: AttritionContext, owner: number, cell: number): number {
  let mustered = 0;
  for (const unit of ctx.entities.all()) {
    if (unit.owner !== owner || unit.hp <= 0 || unit.convoy >= 0 || !bleeds(unit)) continue;
    const at = cellOf(ctx.grid, unit);
    if (at >= 0 && chebyshevCells(ctx.grid, at, cell) <= CAMP_MUSTER_CELLS) mustered += 1;
  }
  return mustered;
}

/**
 * Bleeds every exposed soldier, once per interval.
 *
 * `hurt` is injected for the same reason the rest of the simulation injects it: removing
 * a unit belongs to the sim, so this module decides who bleeds and by how much and stays
 * a pure reading of state.
 */
export function stepAttrition(ctx: AttritionContext, hurt: (unit: Unit, amount: number) => void): void {
  // A snapshot: a bleed can be the last point of health a unit has.
  for (const unit of [...ctx.entities.all()]) {
    // Owner 0 is the tribes. Rule VI already sends raiders home on their own clock, and a
    // tribe that bled in everybody's land would be fighting a second rule it never opted
    // into.
    // At sea a unit is nowhere, so it is not in anybody's borders. Rule V's convoy is
    // out of reach of rule VII as well as of the archers.
    if (unit.owner === 0 || unit.hp <= 0 || unit.convoy >= 0 || !bleeds(unit)) continue;

    const cell = cellOf(ctx.grid, unit);
    if (cell < 0 || !exposedAt(ctx, unit.owner, cell)) {
      unit.attritionTimer = 0;
      continue;
    }
    unit.attritionTimer += 1;
    if (unit.attritionTimer < ATTRITION_INTERVAL_TICKS) continue;
    unit.attritionTimer = 0;
    // Integer percentage with a floor of one point, exactly as starvation does it: a
    // small unit has to die eventually rather than rounding down to immortal.
    hurt(unit, Math.max(1, idiv(unit.maxHp * ATTRITION_PERCENT_PER_INTERVAL, 100)));
  }
}

/** The cell a unit stands in, or -1 when it is off the grid. */
function cellOf(grid: TerrainGrid, unit: Unit): number {
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  return grid.inBounds(col, row) ? grid.index(col, row) : -1;
}

import { idiv, toIntFloor } from './fixed';
import type { EntityStore } from './entities';
import type { BuildingStore } from './buildings';
import type { ProvinceStore } from './provinces';
import type { TerrainGrid } from './terrain';
import {
  BuildingKind,
  CLAIM_TICKS,
  COLONISE_BASE_FOOD,
  COLONISE_DENOMINATOR,
  COLONISE_NUMERATOR,
  UnitKind,
} from './rules';

/**
 * Rules I and III: colonising a neutral province, and losing or claiming one.
 *
 * Ownership is derived from seats, never stored twice, so there is no way for the two to
 * disagree. Everything here is integer.
 */

/**
 * The food a seat must pay to colonise its next province, given how many it already
 * holds. Compounds ×7÷5 with a floor at each step — see the note in rules.ts.
 */
export function colonisePrice(held: number): number {
  let price = COLONISE_BASE_FOOD;
  for (let i = 0; i < held; i++) price = idiv(price * COLONISE_NUMERATOR, COLONISE_DENOMINATOR);
  return price;
}

export interface TerritoryContext {
  provinces: ProvinceStore;
  buildings: BuildingStore;
  entities: EntityStore;
  grid: TerrainGrid;
}

/** The terrain province a unit is standing in, or 0 for unclaimed ground. */
export function provinceAtUnit(ctx: TerritoryContext, unitId: number): number {
  const unit = ctx.entities.get(unitId);
  if (!unit) return 0;
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  if (!ctx.grid.inBounds(col, row)) return 0;
  return ctx.grid.owner(ctx.grid.index(col, row));
}

/**
 * One territory tick: seats that have fallen release their province, and a villager
 * standing alone in a seatless province claims it.
 *
 * `plantSeat` is injected because placing a building is the simulation's job.
 */
export function stepTerritory(
  ctx: TerritoryContext,
  plantSeat: (owner: number, cell: number) => number,
): void {
  // A seat whose building is gone no longer holds anything. Rule III, in one line.
  for (const province of ctx.provinces.all()) {
    if (province.seat < 0) continue;
    const seat = ctx.buildings.get(province.seat);
    if (seat && seat.kind === BuildingKind.Seat && seat.hp > 0) {
      // Ownership follows the seat, including when it changed hands some other way.
      province.owner = seat.owner;
      continue;
    }
    province.seat = -1;
    province.owner = 0;
    province.claimant = 0;
    province.claimTicks = 0;
  }

  // Claims. Only villagers claim, because only villagers plant seats.
  const claimers = new Map<number, Map<number, number>>(); // province → owner → first unit id
  for (const unit of ctx.entities.all()) {
    if (unit.kind !== UnitKind.Villager || unit.owner === 0) continue;
    const index = provinceAtUnit(ctx, unit.id);
    if (index === 0) continue;
    const province = ctx.provinces.get(index);
    if (!province || province.seat >= 0) continue;
    let byOwner = claimers.get(index);
    if (!byOwner) {
      byOwner = new Map();
      claimers.set(index, byOwner);
    }
    // Lowest unit id wins the honour, so the choice never depends on iteration order.
    const existing = byOwner.get(unit.owner);
    if (existing === undefined || unit.id < existing) byOwner.set(unit.owner, unit.id);
  }

  for (const province of ctx.provinces.all()) {
    if (province.seat >= 0) continue;
    const byOwner = claimers.get(province.index);
    if (!byOwner || byOwner.size === 0) {
      province.claimant = 0;
      province.claimTicks = 0;
      continue;
    }
    if (byOwner.size > 1) {
      // Contested: two empires have villagers on the ground, so nobody makes progress.
      // The claim is visible to everyone nearby precisely so this is a fight worth having.
      province.claimant = 0;
      province.claimTicks = 0;
      continue;
    }
    const [owner, unitId] = [...byOwner.entries()][0];
    if (province.claimant !== owner) {
      province.claimant = owner;
      province.claimTicks = 0;
    }
    province.claimTicks += 1;
    if (province.claimTicks < CLAIM_TICKS) continue;

    const unit = ctx.entities.get(unitId)!;
    const cell = ctx.grid.index(toIntFloor(unit.x), toIntFloor(unit.y));
    province.seat = plantSeat(owner, cell);
    province.owner = owner;
    province.everSettled = true;
    province.claimant = 0;
    province.claimTicks = 0;
  }
}

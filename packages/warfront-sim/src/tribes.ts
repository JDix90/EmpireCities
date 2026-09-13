import { idiv, toIntFloor } from './fixed';
import type { EntityStore } from './entities';
import type { BuildingStore } from './buildings';
import type { ProvinceStore } from './provinces';
import type { TerrainGrid } from './terrain';
import type { Rng } from './rng';
import type { StateHasher } from './hash';
import {
  BUILDING_SPECS,
  FIRST_RAID_TICK,
  RAID_BASE_SIZE,
  RAID_DURATION_TICKS,
  RAID_INTERVAL_TICKS,
  RAID_MARCH_LIMIT_TICKS,
  RAID_MAX_SIZE,
  RAID_STAGGER_TICKS,
  RAID_STAGGER_WRAP,
  RAID_SIZE_PER_MINUTE,
  RAID_SIZE_PER_PROVINCE,
  Resource,
  TICKS_PER_MINUTE,
} from './rules';

/**
 * Rule VI: tribes raid from minute two.
 *
 * Every neutral province is a tribe's home. It sends raiders at a settled neighbour, they
 * kill villagers and take loot, and they go home. Colonising the home ends that source —
 * which falls out for free rather than needing a rule, because a province with a seat is
 * no longer neutral and so no longer musters anything.
 *
 * Raids scale with the clock AND with the victim's holdings, which is the anti-turtle
 * half of the rule: the biggest empire is raided hardest.
 */

export interface Raider {
  unit: number;
  /** Cell the raider mustered at and will run back to. */
  homeCell: number;
  /**
   * While marching in: the tick it gives up and turns for home. While looting: the tick
   * it leaves. While returning: the tick it is written off, so a raider that cannot reach
   * its own border can never haunt the map forever.
   */
  returnTick: number;
  /** True once it stopped walking in the victim's land and started its minute of looting. */
  arrived: boolean;
  returning: boolean;
}

export interface TribeHome {
  index: number;
  nextRaidTick: number;
}

/** Per-province geography derived from the grid once: land neighbours and border cells. */
export interface ProvinceGeography {
  /** Province index → land neighbours, ascending. */
  neighbours: Map<number, number[]>;
  /**
   * Province → neighbour → the lowest-index passable cell OF THAT PROVINCE touching it.
   *
   * Raids muster on the frontier, not in the middle of the tribe's land: at 4 km cells a
   * province is ~200 cells across, so a raid that started at an arbitrary interior cell
   * would spend its whole life walking to the border and never reach anybody.
   */
  border: Map<number, Map<number, number>>;
}

/**
 * Land adjacency and a muster cell per province, computed from the terrain.
 *
 * The map document types every border land or sea, but the committed asset carries only
 * the sea lanes. Land adjacency is exactly "two passable cells of different provinces
 * touching", which the grid answers on its own — so tribes need no second data source,
 * and a province reachable only by sea correctly has no land neighbours to raid.
 *
 * One pass over the grid, at construction, never per tick.
 */
export function buildProvinceGeography(grid: TerrainGrid): ProvinceGeography {
  const border = new Map<number, Map<number, number>>();
  for (const p of grid.provinces) border.set(p.index, new Map());

  const touch = (province: number, neighbour: number, cell: number): void => {
    const row = border.get(province);
    if (!row) return;
    const existing = row.get(neighbour);
    // Lowest cell index wins, so the muster point never depends on scan order.
    if (existing === undefined || cell < existing) row.set(neighbour, cell);
  };

  for (let i = 0; i < grid.size; i++) {
    const owner = grid.owner(i);
    if (owner === 0 || !grid.isPassable(i)) continue;
    // Right and down only: every pair of cells is visited once, from its upper-left member.
    const right = grid.colOf(i) + 1 < grid.width ? i + 1 : -1;
    const down = grid.rowOf(i) + 1 < grid.height ? i + grid.width : -1;
    for (const j of [right, down]) {
      if (j < 0 || !grid.isPassable(j)) continue;
      const other = grid.owner(j);
      if (other === 0 || other === owner) continue;
      touch(owner, other, i);
      touch(other, owner, j);
    }
  }

  const neighbours = new Map<number, number[]>();
  for (const [index, row] of border) neighbours.set(index, [...row.keys()].sort((a, b) => a - b));
  return { neighbours, border };
}

/**
 * The tick a given tribe first musters.
 *
 * Staggered by the tribe's own province index so that minute two brings ONE raid and the
 * whole frontier is raiding by minute four, which is what the brief's timeline describes.
 * Exported because it is the honest way for a caller — or a test — to ask when a
 * particular tribe is due, rather than assuming every tribe shares one clock.
 */
export function firstRaidTick(provinceIndex: number): number {
  return FIRST_RAID_TICK + (provinceIndex % RAID_STAGGER_WRAP) * RAID_STAGGER_TICKS;
}

/** Every province is a tribe's home until somebody settles it. */
export class TribeStore {
  private readonly homes: TribeHome[] = [];
  private readonly byIndex = new Map<number, TribeHome>();
  private raiders: Raider[] = [];

  constructor(indices: readonly number[]) {
    for (const index of [...indices].sort((a, b) => a - b)) {
      // Staggered first raids: minute two brings ONE raid, and the whole frontier is
      // raiding by minute four. See RAID_STAGGER_TICKS for why that matters.
      const home: TribeHome = { index, nextRaidTick: firstRaidTick(index) };
      this.homes.push(home);
      this.byIndex.set(index, home);
    }
  }

  home(index: number): TribeHome | undefined {
    return this.byIndex.get(index);
  }

  /** Homes in ascending province index. Do not mutate the array. */
  all(): readonly TribeHome[] {
    return this.homes;
  }

  /** Raiders currently out, in muster order. Do not mutate the array. */
  activeRaiders(): readonly Raider[] {
    return this.raiders;
  }

  addRaider(raider: Raider): void {
    this.raiders.push(raider);
  }

  /** Forgets a raider — it went home, or it died on the way. */
  dropRaider(unitId: number): void {
    const index = this.raiders.findIndex((r) => r.unit === unitId);
    if (index >= 0) this.raiders.splice(index, 1);
  }

  hashInto(h: StateHasher): void {
    h.int(this.homes.length);
    for (const home of this.homes) h.int(home.index).int(home.nextRaidTick);
    h.int(this.raiders.length);
    for (const r of this.raiders) {
      h.int(r.unit).int(r.homeCell).int(r.returnTick).bool(r.arrived).bool(r.returning);
    }
  }
}

export interface TribeContext {
  tribes: TribeStore;
  provinces: ProvinceStore;
  buildings: BuildingStore;
  entities: EntityStore;
  grid: TerrainGrid;
  geography: ProvinceGeography;
  rng: Rng;
}

/**
 * Raiders sent this raid: bigger with the clock, and bigger against a bigger empire.
 *
 * Holdings count from the SECOND province, not the first. The rule is anti-turtle — "the
 * biggest empire is raided hardest" — and a seat that still holds only the province it
 * started in has not expanded at all, so charging it the expansion tax is backwards. It
 * also made the very first raid twice the size it should be: the brief's minute-two beat
 * is one raid on one lumber camp, and a doubled opening raid against an economy that
 * cannot yet have bought a spear killed every villager in the lab's first Colonist mirror.
 */
export function raidSize(tick: number, victimProvinces: number): number {
  const byClock = idiv(tick, TICKS_PER_MINUTE * RAID_SIZE_PER_MINUTE);
  const expanded = victimProvinces > 1 ? victimProvinces - 1 : 0;
  const byHoldings = idiv(expanded, RAID_SIZE_PER_PROVINCE);
  const size = RAID_BASE_SIZE + byClock + byHoldings;
  return size > RAID_MAX_SIZE ? RAID_MAX_SIZE : size;
}

/** Chebyshev distance in cells between two cell indices. */
function cellDistance(grid: TerrainGrid, a: number, b: number): number {
  const dc = Math.abs(grid.colOf(a) - grid.colOf(b));
  const dr = Math.abs(grid.rowOf(a) - grid.rowOf(b));
  return dc > dr ? dc : dr;
}

/**
 * Where a raid is aimed: the victim's nearest work to the frontier it crossed.
 *
 * The brief's own minute-two beat is "first tribal raid on a border lumber camp", and a
 * gathering building is where the villagers are — which is the point of the rule. So a
 * producing building outranks any other, and among equals the nearest one to the landing
 * cell wins, with the lowest building id breaking a tie. Falls back to the landing cell
 * itself when the victim has built nothing in the province.
 */
function raidTargetCell(ctx: TribeContext, province: number, victim: number, landingCell: number): number {
  let best = -1;
  let bestProduces = false;
  let bestDistance = 0;
  // Ascending building id, so a tie on both keys leaves the lowest id in place.
  for (const building of ctx.buildings.all()) {
    if (building.owner !== victim) continue;
    if (ctx.grid.owner(building.cell) !== province) continue;
    const produces = BUILDING_SPECS[building.kind]?.produces !== Resource.None;
    if (best >= 0 && bestProduces && !produces) continue;
    const distance = cellDistance(ctx.grid, building.cell, landingCell);
    if (best < 0 || (produces && !bestProduces) || distance < bestDistance) {
      best = building.cell;
      bestProduces = produces;
      bestDistance = distance;
    }
  }
  return best >= 0 ? best : landingCell;
}

/**
 * One tribe tick: launch the raids that are due, turn raiders for home when their time is
 * up, and retire the ones that made it back.
 *
 * `spawnRaider`, `orderTo` and `despawn` are injected because creating units, issuing
 * movement and removing units belong to the simulation.
 */
export function stepTribes(
  ctx: TribeContext,
  tick: number,
  spawnRaider: (cell: number) => number,
  orderTo: (unitId: number, cell: number) => void,
  despawn: (unitId: number) => void,
): void {
  for (const home of ctx.tribes.all()) {
    const province = ctx.provinces.get(home.index);
    // Colonising the home ends that source — for free: a settled province is not neutral.
    if (!province || province.owner !== 0 || province.seat >= 0) continue;
    if (tick < home.nextRaidTick) continue;
    home.nextRaidTick = tick + RAID_INTERVAL_TICKS;

    const targets = (ctx.geography.neighbours.get(home.index) ?? []).filter((index) => {
      const neighbour = ctx.provinces.get(index);
      return neighbour !== undefined && neighbour.owner !== 0;
    });
    // Nobody to raid: the tribe sits, and tries again next interval.
    if (targets.length === 0) continue;

    const target = targets[ctx.rng.nextInt(targets.length)];
    const victim = ctx.provinces.get(target)!;
    // Muster on the tribe's own side of the frontier, land on the victim's side of it.
    const musterCell = ctx.geography.border.get(home.index)?.get(target);
    const landingCell = ctx.geography.border.get(target)?.get(home.index);
    if (musterCell === undefined || landingCell === undefined) continue;
    const targetCell = raidTargetCell(ctx, target, victim.owner, landingCell);

    const size = raidSize(tick, ctx.provinces.heldBy(victim.owner));
    for (let i = 0; i < size; i++) {
      const unitId = spawnRaider(musterCell);
      orderTo(unitId, targetCell);
      ctx.tribes.addRaider({
        unit: unitId,
        homeCell: musterCell,
        returnTick: tick + RAID_MARCH_LIMIT_TICKS,
        arrived: false,
        returning: false,
      });
    }
  }

  for (const raider of [...ctx.tribes.activeRaiders()]) {
    const unit = ctx.entities.get(raider.unit);
    if (!unit) {
      // Killed in the raid. The sim drops the record when it kills the unit; this is the
      // belt to that braces, so a stale record can never outlive its raider.
      ctx.tribes.dropRaider(raider.unit);
      continue;
    }
    if (!raider.returning) {
      // Arrival, not the clock, starts the looting: the raid lasts a minute IN the
      // victim's land, however long the march to it took. Without that, a raid on a
      // distant target would turn for home before it ever met a villager.
      if (!raider.arrived && !unit.moving) {
        raider.arrived = true;
        const leaveAt = tick + RAID_DURATION_TICKS;
        if (leaveAt < raider.returnTick) raider.returnTick = leaveAt;
      }
      if (tick < raider.returnTick) continue;
      raider.returning = true;
      // The same limit again, now as a deadline: a raider that cannot walk home is
      // written off rather than wandering the map for the rest of the match.
      raider.returnTick = tick + RAID_MARCH_LIMIT_TICKS;
      orderTo(raider.unit, raider.homeCell);
      continue;
    }
    const col = toIntFloor(unit.x);
    const row = toIntFloor(unit.y);
    const atHome = ctx.grid.inBounds(col, row) && ctx.grid.index(col, row) === raider.homeCell;
    if (!atHome && tick < raider.returnTick) continue;
    // Home with the loot. The tribe keeps no standing army between raids: rule VI is a
    // raid, not a war, and a tribe that accumulated an army would become a fifth player.
    ctx.tribes.dropRaider(raider.unit);
    despawn(raider.unit);
  }
}

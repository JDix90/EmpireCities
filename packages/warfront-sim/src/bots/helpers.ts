import { idiv } from '../fixed';
import { cellOf, type BotView } from '../bot';
import type { Building } from '../buildings';
import type { Unit } from '../entities';
import type { TerrainGrid } from '../terrain';
import {
  BUILDER_SLOTS,
  BUILDING_SPECS,
  BuildingKind,
  Resource,
  TICKS_PER_MINUTE,
  UnitKind,
  type BuildingKindValue,
} from '../rules';

/**
 * The things every policy needs: who is idle, where a building can go, which neutral
 * ground is nearest.
 *
 * All of it is pure and deterministic — ties break on the lowest id or the lowest cell
 * index, never on iteration order — so two runs of the same match make the same choices.
 * These are the expensive part of a bot, so each is bounded: the lab runs thousands of
 * matches and a policy that scanned 600,000 cells every second would dominate the clock.
 */

/** Chebyshev distance in cells between two cell indices. */
export function cellDistance(grid: TerrainGrid, a: number, b: number): number {
  const dc = Math.abs(grid.colOf(a) - grid.colOf(b));
  const dr = Math.abs(grid.rowOf(a) - grid.rowOf(b));
  return dc > dr ? dc : dr;
}

/** This seat's units, ascending id. */
export function own(view: BotView, kind?: number): Unit[] {
  return view.units.filter((u) => u.owner === view.seat && (kind === undefined || u.kind === kind));
}

/** This seat's buildings, ascending id. */
export function ownBuildings(view: BotView, kind?: BuildingKindValue): Building[] {
  return view.buildings.filter((b) => b.owner === view.seat && (kind === undefined || b.kind === kind));
}

/** This seat's seat building, or null if it has none left standing. */
export function seatBuilding(view: BotView): Building | null {
  return ownBuildings(view, BuildingKind.Seat)[0] ?? null;
}

/**
 * Villagers with no job. Rule II says a villager is assigned, never clicked, so "idle"
 * means unemployed rather than standing still — a villager walking to its farm is
 * working, and one standing on a finished house is not.
 */
export function idleVillagers(view: BotView): Unit[] {
  return own(view, UnitKind.Villager).filter((u) => u.job < 0);
}

/** Buildings of this seat with room for another worker, nearest the reference cell first. */
export function hiring(view: BotView, near: number): Building[] {
  const out = view.buildings.filter((b) => {
    if (b.owner !== view.seat) return false;
    const spec = BUILDING_SPECS[b.kind];
    if (!spec) return false;
    const slots = b.complete ? spec.workerSlots : BUILDER_SLOTS;
    return slots > 0 && b.workers.length < slots;
  });
  // Nearest first so a villager takes the job it can reach soonest; lowest id breaks a
  // tie, because the list is already in ascending id.
  return stableSortBy(out, (b) => cellDistance(view.grid, b.cell, near));
}

/**
 * A stable sort by an integer key. `Array.prototype.sort` is only guaranteed stable in
 * modern engines, and "only on the engines we tested" is not a determinism argument, so
 * the index is folded in as the final key.
 */
export function stableSortBy<T>(items: readonly T[], key: (item: T) => number): T[] {
  return items
    .map((item, i) => ({ item, k: key(item), i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((e) => e.item);
}

/**
 * A cell a building of this kind could be raised on, searched outwards from `near`.
 *
 * Ring by ring, and within a ring in row-major order, so the answer is a pure function of
 * the state — and bounded by `maxRadius`, because this runs once a second per bot for
 * thousands of matches. Returns -1 when nothing inside the radius will take it.
 */
export function findBuildSite(
  view: BotView,
  kind: BuildingKindValue,
  near: number,
  maxRadius: number,
  provinceIndex = 0,
): number {
  const grid = view.grid;
  const spec = BUILDING_SPECS[kind];
  if (!spec) return -1;
  const occupied = new Set(view.buildings.map((b) => b.cell));
  const col0 = grid.colOf(near);
  const row0 = grid.rowOf(near);
  const wanted = provinceIndex > 0 ? provinceIndex : grid.owner(near);

  for (let r = 0; r <= maxRadius; r++) {
    for (let row = row0 - r; row <= row0 + r; row++) {
      for (let col = col0 - r; col <= col0 + r; col++) {
        // Only the ring's edge: the interior was covered by a smaller radius.
        if (r > 0 && Math.abs(row - row0) !== r && Math.abs(col - col0) !== r) continue;
        if (!grid.inBounds(col, row)) continue;
        const cell = grid.index(col, row);
        if (!grid.isPassable(cell) || occupied.has(cell)) continue;
        if (grid.owner(cell) !== wanted) continue;
        if (spec.biomes.length > 0 && !spec.biomes.includes(grid.biome(cell))) continue;
        return cell;
      }
    }
  }
  return -1;
}

/** True when this seat can pay for the building. */
export function canAfford(view: BotView, kind: BuildingKindValue): boolean {
  const spec = BUILDING_SPECS[kind];
  return !!spec && view.player.timber >= spec.timber && view.player.silver >= spec.silver;
}

/** How many of a kind this seat has, counting sites under construction. */
export function countOwn(view: BotView, kind: BuildingKindValue): number {
  return ownBuildings(view, kind).length;
}

/** Producing buildings of this seat that still have a free worker slot. */
export function understaffed(view: BotView): Building[] {
  return view.buildings.filter((b) => {
    if (b.owner !== view.seat || !b.complete) return false;
    const spec = BUILDING_SPECS[b.kind];
    return !!spec && spec.produces !== Resource.None && b.workers.length < spec.workerSlots;
  });
}

export interface NeutralTarget {
  province: number;
  /** The cell on that province's side of the frontier — where a colonist walks to. */
  cell: number;
  distance: number;
}

/**
 * Unsettled provinces this seat shares a land border with, nearest first.
 *
 * Two things make this cheap enough for a lab: it walks the seat's own frontiers rather
 * than the map, and the frontier cells come from the province geography the match already
 * derives once for the tribes. Scanning all six hundred thousand cells once a second per
 * bot — which is what "find the nearest neutral cell" naively means — would cost more
 * than the simulation it is playing.
 *
 * Rule I buys land NOBODY has held; ground whose seat was razed is claimed by standing on
 * it, never bought, so `everSettled` provinces are deliberately not offered. A policy that
 * tried to buy one would spend its match issuing an order the simulation refuses.
 */
export function unsettledFrontiers(view: BotView, from: number, limit = 4): NeutralTarget[] {
  const held = view.provinces.filter((p) => p.owner === view.seat).map((p) => p.index);
  const byIndex = new Map(view.provinces.map((p) => [p.index, p]));
  const out: NeutralTarget[] = [];
  const seen = new Set<number>();

  for (const home of held) {
    for (const neighbour of view.geography.neighbours.get(home) ?? []) {
      if (seen.has(neighbour)) continue;
      const province = byIndex.get(neighbour);
      if (!province || province.owner !== 0 || province.seat >= 0 || province.everSettled) continue;
      // The cell on the NEIGHBOUR's side of the frontier: standing there is standing in
      // the province being colonised, which is what rule I requires.
      const cell = view.geography.border.get(neighbour)?.get(home);
      if (cell === undefined) continue;
      seen.add(neighbour);
      out.push({ province: neighbour, cell, distance: cellDistance(view.grid, cell, from) });
    }
  }
  return stableSortBy(out, (t) => t.distance).slice(0, limit);
}

/** Whether a unit has arrived at (or beside) a cell — the sim's own work radius. */
export function isAt(view: BotView, unit: Unit, cell: number): boolean {
  const at = cellOf(unit, view.grid);
  return at >= 0 && cellDistance(view.grid, at, cell) <= 1;
}

/** Population headroom, in whole units. */
export function popRoom(view: BotView): number {
  return view.player.popCap - view.player.pop;
}

/** Food a seat can spend without starving itself before the next minute lands. */
export function spareFood(view: BotView, reserve: number): number {
  const spare = view.player.food - reserve;
  return spare > 0 ? spare : 0;
}

/** Minutes elapsed, floored — how a policy reads the clock. */
export function minutes(view: BotView): number {
  return idiv(view.tick, TICKS_PER_MINUTE);
}

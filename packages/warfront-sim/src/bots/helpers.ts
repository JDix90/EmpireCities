import { idiv } from '../fixed';
import { cellOf, type BotView } from '../bot';
import { isCoastal } from '../coast';
import type { Building } from '../buildings';
import type { Unit } from '../entities';
import type { TerrainGrid } from '../terrain';
import {
  BUILDER_SLOTS,
  BUILDING_COMBAT,
  BUILDING_SPECS,
  BuildingKind,
  CAMP_RADIUS_CELLS,
  COMBAT_SPECS,
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
/**
 * Ground rules the `biomes` table cannot express.
 *
 * A port must stand on a coast, and being coastal is a property of a cell's NEIGHBOURS
 * rather than of the cell, so the biome list — a whole-cell test — cannot say it. The
 * simulation checks it on the way in and silently refuses a build that fails, which is a
 * fine rule and a terrible thing for a bot to discover by trial: without this, a policy
 * whose order contains a port proposes the first passable cell it finds, is refused, and
 * proposes the same cell again a second later for the rest of the match. Measured before
 * this existed: fourteen thousand refused build commands across twelve matches, three
 * convoys, and a build order that never got past the harbour it could not raise.
 *
 * The lane test is here for the same reason — the simulation refuses a harbour in a
 * province with no lane out of it, so a bot that keeps asking is a bot that never builds
 * anything again.
 */
function sitePasses(view: BotView, kind: BuildingKindValue, cell: number): boolean {
  // Woodland is a flag beside the biome, so the spec's biome list is empty for a lumber
  // camp and this is the whole of its ground rule. Without the clause a policy proposes
  // bare highland, the simulation silently refuses it, and the policy proposes it again a
  // second later — the fourteen-thousand-refusal shape the port had before #333.
  if (kind === BuildingKind.LumberCamp) return view.grid.isWooded(cell);
  // A light is coastal and nothing else — the simulation refuses an inland one and
  // accepts every other, and this function's job is to agree with it exactly. Whether a
  // particular shore is WORTH watching is a policy's question, not a siting rule.
  if (kind === BuildingKind.Lighthouse) return isCoastal(view.grid, cell);
  if (kind !== BuildingKind.Port) return true;
  return isCoastal(view.grid, cell) && view.sea.lanesFrom(view.grid.owner(cell)).length > 0;
}

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
        if (!sitePasses(view, kind, cell)) continue;
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
/**
 * Whether one of this seat's finished buildings has its guns on a cell.
 *
 * The counterpart to `campCovers`, and it is what lets a policy tell "a raider is near
 * this" from "a raider is near this and something is shooting at it". Without the
 * distinction a bot evacuates ground it has already paid to defend, which is how a tower
 * ends up guarding an empty lumber camp.
 *
 * Reads `BUILDING_COMBAT`, which is the table of buildings that shoot — and NOT
 * `COMBAT_SPECS`, which looks like it would work and does not. `COMBAT_SPECS` is keyed by
 * unit kind, `UnitKind.Ram` is 7 and `BuildingKind.Tower` is also 7, so asking it for a
 * tower silently hands back the ram: range one instead of six, with no error anywhere. It
 * cost an afternoon. The seat is in this table too, which is the point of reading it
 * rather than hard-coding a tower: rule III arms the capital, so work beside it is already
 * defended and does not want a tower of its own.
 */
export function underGuard(view: BotView, cell: number): boolean {
  return view.buildings.some((b) => {
    if (b.owner !== view.seat || !b.complete) return false;
    const spec = BUILDING_COMBAT[b.kind];
    return spec !== undefined && cellDistance(view.grid, b.cell, cell) <= spec.range;
  });
}

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

/**
 * Soldiers of this seat that have arrived and are standing on somebody else's ground.
 *
 * The bot decides this for itself from the province list rather than being told, which
 * keeps rule VII out of `BotView`: the view is the fog seam, and who owns a province is
 * public information in this game — "ownership is public on the overview" — so a policy
 * reading it needs no new privilege.
 */
export function soldiersOnForeignGround(view: BotView): Unit[] {
  const owner = new Map(view.provinces.map((p) => [p.index, p.owner]));
  return view.units.filter((u) => {
    if (u.owner !== view.seat || u.moving || !COMBAT_SPECS[u.kind]) return false;
    const cell = cellOf(u, view.grid);
    if (cell < 0) return false;
    const holder = owner.get(view.grid.owner(cell)) ?? 0;
    return holder !== 0 && holder !== view.seat;
  });
}

/** A camp of this seat's, standing or rising, within its radius of a cell. */
export function campCovers(view: BotView, cell: number): boolean {
  return view.buildings.some(
    (b) =>
      b.kind === BuildingKind.Camp &&
      b.owner === view.seat &&
      cellDistance(view.grid, b.cell, cell) <= CAMP_RADIUS_CELLS,
  );
}

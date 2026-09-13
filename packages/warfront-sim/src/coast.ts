import { chebyshevCells } from './geometry';
import { Biome, type TerrainGrid } from './terrain';

/**
 * The coastline, derived rather than stored.
 *
 * There is no coast BIOME — the asset carries void, sea, plains, forest, highland,
 * mountain, river and desert, and nothing else — so a coast has to be computed: a
 * passable land cell with sea orthogonally beside it. Derived is the right answer anyway,
 * because it cannot fall out of step with the cells the way a second stored layer could,
 * and because rule V needs it per PROVINCE rather than globally.
 *
 * Orthogonal and not diagonal on purpose. A cell touching sea only at a corner is a
 * headland you can see the water from, not a place to put a harbour, and counting those
 * would let a port sit on a one-cell diagonal nick in the coastline.
 *
 * Built once per grid and handed in, exactly like `buildProvinceGeography`: it costs a
 * pass over six hundred thousand cells and depends on the grid alone.
 */

export interface CoastIndex {
  /** Province index → its coastal cells, ascending. Absent for a landlocked province. */
  byProvince: Map<number, number[]>;
}

/** True when this cell is land you can stand on with sea directly beside it. */
export function isCoastal(grid: TerrainGrid, cell: number): boolean {
  if (cell < 0 || cell >= grid.size || !grid.isPassable(cell)) return false;
  const col = grid.colOf(cell);
  const row = grid.rowOf(cell);
  for (const [dc, dr] of ORTHOGONAL) {
    const c = col + dc;
    const r = row + dr;
    if (!grid.inBounds(c, r)) continue;
    if (grid.biome(grid.index(c, r)) === Biome.Sea) return true;
  }
  return false;
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function buildCoastIndex(grid: TerrainGrid): CoastIndex {
  const byProvince = new Map<number, number[]>();
  // Ascending cell index, because the scan is in that order — so every list is sorted
  // without sorting, and every choice made from one is stable across machines.
  for (let cell = 0; cell < grid.size; cell++) {
    if (!isCoastal(grid, cell)) continue;
    const province = grid.owner(cell);
    if (province <= 0) continue;
    const list = byProvince.get(province);
    if (list) list.push(cell);
    else byProvince.set(province, [cell]);
  }
  return { byProvince };
}

/**
 * The beaches of a province, as seen from a departure point.
 *
 * "Islands have several beaches so one tower can't seal them" — so this returns a SPREAD
 * of landing sites rather than the nearest few, which would all sit in the same bay under
 * the same tower. The coast is sorted by distance from where the convoy sails from, and
 * then sites are taken greedily with a minimum separation between them: the first beach
 * is the closest crossing, and each one after it is the closest remaining that is not
 * already covered by a beach on the list.
 *
 * Deterministic end to end — the input list is in ascending cell order, the sort is
 * stable, and ties break on the lower cell.
 */
export function beachesOf(
  grid: TerrainGrid,
  coast: CoastIndex,
  province: number,
  from: number,
  limit: number,
  separation: number,
): number[] {
  const cells = coast.byProvince.get(province);
  if (!cells || cells.length === 0) return [];

  const ranked = cells
    .map((cell) => ({ cell, d: chebyshevCells(grid, cell, from) }))
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.cell - b.cell));

  const beaches: number[] = [];
  for (const { cell } of ranked) {
    if (beaches.length >= limit) break;
    if (beaches.some((b) => chebyshevCells(grid, b, cell) < separation)) continue;
    beaches.push(cell);
  }
  // Ascending, so a beach's identity does not depend on which port was asking.
  return beaches.sort((a, b) => a - b);
}

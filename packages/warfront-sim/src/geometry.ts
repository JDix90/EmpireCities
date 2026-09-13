import { FP_HALF, FP_ONE, type Fixed } from './fixed';

/**
 * Cell geometry, split out so modules that need a cell's centre — the sim, combat, the
 * bots — can have it without importing each other. `sim.ts` re-exports `cellCentre` so
 * every existing importer keeps working.
 */

/** Fixed position of the centre of cell column/row `i`. */
export function cellCentre(i: number): Fixed {
  return i * FP_ONE + FP_HALF;
}

/**
 * Chebyshev distance between two cells, in whole cells.
 *
 * Chebyshev rather than Euclidean because movement is eight-way: a diagonal step costs
 * the same as an orthogonal one, so a radius drawn this way is the set of cells actually
 * reachable in that many steps. Every "within N cells" rule in the package means this.
 */
export function chebyshevCells(grid: CellGrid, a: number, b: number): number {
  const dc = Math.abs(grid.colOf(a) - grid.colOf(b));
  const dr = Math.abs(grid.rowOf(a) - grid.rowOf(b));
  return dc > dr ? dc : dr;
}

/** The part of a terrain grid this module needs — kept narrow so nothing imports the sim. */
export interface CellGrid {
  colOf(cell: number): number;
  rowOf(cell: number): number;
}

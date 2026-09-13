/**
 * Hit-testing buildings, the other half of selection.ts.
 *
 * Units are picked by proximity because they are round and they move; a building sits on
 * exactly one cell, so it is picked by the cell under the cursor. Keeping that rule here
 * rather than in the canvas means it can be tested without a GPU, and means the panel and
 * the plane agree about what "clicking a building" means.
 */

import type { Sim, TerrainGrid } from '@borderfall/warfront-sim';

/** The building on the cell under a world point, or null. */
export function buildingAtPoint(sim: Sim, grid: TerrainGrid, worldX: number, worldY: number): number | null {
  const col = Math.floor(worldX);
  const row = Math.floor(worldY);
  if (!grid.inBounds(col, row)) return null;
  return sim.buildings.atCell(grid.index(col, row))?.id ?? null;
}

/** The cell a world point falls in, or -1 when it is off the grid. */
export function cellAtPoint(grid: TerrainGrid, worldX: number, worldY: number): number {
  const col = Math.floor(worldX);
  const row = Math.floor(worldY);
  return grid.inBounds(col, row) ? grid.index(col, row) : -1;
}

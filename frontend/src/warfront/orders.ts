/**
 * Turning a pointer position into a command the deterministic simulation will accept.
 *
 * The simulation takes 16.16 fixed-point integers in cell units and rejects anything
 * else at the boundary. The renderer works in floats, so this is the one place the two
 * meet, and it is deliberately strict: clamp into the grid first, then round to a fixed
 * integer. A command built any other way would either be refused by `validateCommand`
 * or, worse, smuggle a float into a replay.
 */

import { FP_ONE, type TerrainGrid } from '@borderfall/warfront-sim';

/** Largest fixed value the sim's range invariant allows. */
const FP_LIMIT = 2147483647;

/**
 * Converts a float world coordinate to a 16.16 fixed integer, clamped to the grid.
 * Returns whole integers only, so the value is always a legal command argument.
 */
export function toFixedWorld(value: number, maxCells: number): number {
  // NaN has no sensible position, so it becomes the origin. An infinity does: it is a
  // pointer somewhere off the world, and clamping sends it to the edge the player was
  // heading for rather than teleporting the order to the top-left corner.
  if (Number.isNaN(value)) return 0;
  const clamped = Math.min(Math.max(value, 0), maxCells);
  const fixed = Math.round(clamped * FP_ONE);
  return Math.min(Math.max(fixed, 0), FP_LIMIT);
}

/** A move target, clamped to the grid and converted to the simulation's units. */
export function moveTarget(grid: TerrainGrid, worldX: number, worldY: number): { x: number; y: number } {
  return {
    // The grid's far edge is exclusive: a click on the last pixel must not land one cell
    // outside the world, which `nearestPassable` would then have to rescue.
    x: toFixedWorld(worldX, grid.width - 1 / FP_ONE),
    y: toFixedWorld(worldY, grid.height - 1 / FP_ONE),
  };
}

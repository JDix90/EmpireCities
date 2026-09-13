/**
 * A throwaway starting position for the tactical view, so there is something to select
 * and order about while the real match setup (seats, colonisation, economy) does not
 * exist yet. Step 3 replaces this wholesale.
 *
 * Deterministic on purpose: the same grid and the same arguments always produce the same
 * scenario, so a replay recorded here reproduces exactly. There is no randomness at all
 * — units are the N passable cells nearest the province centroid, ties broken by cell
 * index, which also makes them a tight squad rather than a line smeared across a
 * province.
 */

import { cellCentre, fpRatio, type Scenario, type TerrainGrid } from '@borderfall/warfront-sim';

/**
 * Placeholder march speed, in cells per tick. At 4 km cells and 15 ticks/s this crosses
 * the western twenty in roughly three and a half minutes, which is the right order of
 * magnitude for a 20–25 minute match. A real number is step 3's job, from the economy
 * and unit table.
 */
export const SANDBOX_SPEED = fpRatio(1, 5);

export interface SandboxOptions {
  /** Province to muster in, e.g. 'lugdunensis' (the Gaul seat). */
  territoryId: string;
  /** How many movers to place. */
  count: number;
  /** Owning seat index. */
  owner?: number;
  /** Cells per tick, fixed-point. */
  speed?: number;
}

export interface SandboxResult {
  scenario: Scenario;
  /** Cell the squad was mustered around, so the camera can open looking at it. */
  originCell: number;
}

/**
 * Builds the scenario. Throws when the province has no passable cells, which would mean
 * the terrain asset and the map document disagree — worth failing loudly rather than
 * quietly producing an empty match.
 */
export function buildSandboxScenario(grid: TerrainGrid, options: SandboxOptions): SandboxResult {
  const { territoryId, count } = options;
  const owner = options.owner ?? 1;
  const speed = options.speed ?? SANDBOX_SPEED;

  const provinceIndex = grid.provinceIndex(territoryId);
  if (provinceIndex === 0) throw new Error(`warfront: no province "${territoryId}" in the terrain asset`);

  const candidates: number[] = [];
  let sumCol = 0;
  let sumRow = 0;
  for (let i = 0; i < grid.size; i++) {
    if (grid.owner(i) !== provinceIndex || !grid.isPassable(i)) continue;
    candidates.push(i);
    sumCol += grid.colOf(i);
    sumRow += grid.rowOf(i);
  }
  if (candidates.length === 0) throw new Error(`warfront: province "${territoryId}" has no passable cells`);

  const centroidCol = sumCol / candidates.length;
  const centroidRow = sumRow / candidates.length;
  const ranked = candidates
    .map((i) => {
      const dc = grid.colOf(i) - centroidCol;
      const dr = grid.rowOf(i) - centroidRow;
      return { i, d: dc * dc + dr * dr };
    })
    .sort((a, b) => a.d - b.d || a.i - b.i);

  const chosen = ranked.slice(0, Math.max(1, Math.min(count, ranked.length)));
  return {
    scenario: {
      units: chosen.map(({ i }) => ({
        owner,
        x: cellCentre(grid.colOf(i)),
        y: cellCentre(grid.rowOf(i)),
        speed,
      })),
    },
    originCell: chosen[0].i,
  };
}

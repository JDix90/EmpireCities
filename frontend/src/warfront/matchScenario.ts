/**
 * The opening position: a seat, four villagers and a scout, with the brief's starting
 * stock. This replaces step 2's throwaway squad — there is now an economy to open with.
 *
 * Deterministic on purpose: the same grid and the same arguments always produce the same
 * scenario, so a replay recorded here reproduces exactly. There is no randomness at all.
 * The seat takes the passable cell nearest the province's centre of mass, ties broken by
 * cell index, and everybody starts standing on it.
 */

import {
  START_FOOD,
  START_SCOUTS,
  START_SILVER,
  START_TIMBER,
  START_VILLAGERS,
  TICKS_PER_MINUTE,
  UNIT_SPECS,
  UnitKind,
  BuildingKind,
  FP_ONE,
  cellCentre,
  idiv,
  type Scenario,
  type TerrainGrid,
  type UnitKindValue,
} from '@borderfall/warfront-sim';

export interface OpeningOptions {
  /** Province to open in, e.g. 'lugdunensis' (the Gaul seat). */
  territoryId: string;
  /** Owning seat index. */
  owner?: number;
  villagers?: number;
  scouts?: number;
}

export interface OpeningResult {
  scenario: Scenario;
  /** Cell the seat stands on, so the camera can open looking at it. */
  seatCell: number;
  owner: number;
}

/**
 * A unit's pace in the simulation's units. The table is per minute so it stays readable;
 * the sim does this same conversion when it trains one, and matching it here is what
 * keeps a scenario villager and a trained villager the same unit.
 */
export function speedOf(kind: UnitKindValue): number {
  return Math.max(1, idiv(UNIT_SPECS[kind].speedPerMinute * FP_ONE, TICKS_PER_MINUTE));
}

/**
 * Builds the opening. Throws when the province has no passable cells, which would mean
 * the terrain asset and the map document disagree — worth failing loudly rather than
 * quietly producing a match nobody can play.
 */
export function buildOpeningScenario(grid: TerrainGrid, options: OpeningOptions): OpeningResult {
  const owner = options.owner ?? 1;
  const villagers = options.villagers ?? START_VILLAGERS;
  const scouts = options.scouts ?? START_SCOUTS;

  const provinceIndex = grid.provinceIndex(options.territoryId);
  if (provinceIndex === 0) throw new Error(`warfront: no province "${options.territoryId}" in the terrain asset`);

  let sumCol = 0;
  let sumRow = 0;
  let count = 0;
  for (let i = 0; i < grid.size; i++) {
    if (grid.owner(i) !== provinceIndex || !grid.isPassable(i)) continue;
    sumCol += grid.colOf(i);
    sumRow += grid.rowOf(i);
    count += 1;
  }
  if (count === 0) throw new Error(`warfront: province "${options.territoryId}" has no passable cells`);

  const centroidCol = sumCol / count;
  const centroidRow = sumRow / count;
  let seatCell = -1;
  let best = Infinity;
  for (let i = 0; i < grid.size; i++) {
    if (grid.owner(i) !== provinceIndex || !grid.isPassable(i)) continue;
    const dc = grid.colOf(i) - centroidCol;
    const dr = grid.rowOf(i) - centroidRow;
    const d = dc * dc + dr * dr;
    // Strictly nearer only: the scan is ascending, so an equal distance keeps the lower
    // cell index and the choice never depends on scan direction.
    if (d < best) {
      best = d;
      seatCell = i;
    }
  }

  const x = cellCentre(grid.colOf(seatCell));
  const y = cellCentre(grid.rowOf(seatCell));
  const roster: UnitKindValue[] = [
    ...Array.from({ length: villagers }, () => UnitKind.Villager as UnitKindValue),
    ...Array.from({ length: scouts }, () => UnitKind.Scout as UnitKindValue),
  ];

  return {
    scenario: {
      players: [{ index: owner, food: START_FOOD, timber: START_TIMBER, silver: START_SILVER }],
      buildings: [{ owner, kind: BuildingKind.Seat, cell: seatCell }],
      units: roster.map((kind) => ({ owner, kind, x, y, speed: speedOf(kind) })),
    },
    seatCell,
    owner,
  };
}

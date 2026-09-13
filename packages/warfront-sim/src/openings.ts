import { cellCentre } from './geometry';
import { idiv, FP_ONE } from './fixed';
import type { TerrainGrid } from './terrain';
import type { Scenario } from './sim';
import {
  BuildingKind,
  START_FOOD,
  START_SCOUTS,
  START_SILVER,
  START_TIMBER,
  START_VILLAGERS,
  TICKS_PER_MINUTE,
  UNIT_SPECS,
  UnitKind,
  type UnitKindValue,
} from './rules';

/**
 * Opening positions: the four seats, and how a match starts from them.
 *
 * The seats are the brief's, chosen against the map's own adjacency list rather than by
 * eye — every one is at least two hops from every other, Gaul and Hispania eat the raids,
 * and Rome and Carthage fight over the islands. The ORDER matters: decision 22 makes the
 * default two-seat matchup Rome against Gaul, so those two come first and a two-seat
 * opening is `SEATS.slice(0, 2)`.
 *
 * Everything here is deterministic and integer. Given the same grid and the same seat
 * list, the opening is byte-identical on every machine, which is what lets the lab
 * reproduce a match from its seed alone.
 */

export interface SeatDefinition {
  /** territory_id in the terrain asset. */
  territoryId: string;
  /** Display name, for lab output and the UI. */
  name: string;
  /** One line on what this seat's game is, from the brief's measured seat table. */
  character: string;
}

export const SEATS: readonly SeatDefinition[] = [
  { territoryId: 'italia_central', name: 'Rome', character: 'Spine of Italy, two lanes, islands contested both sides' },
  { territoryId: 'lugdunensis', name: 'Gaul', character: 'Widest land frontier, Germanic border, one hop from Britannia' },
  { territoryId: 'africa_proconsularis', name: 'Carthage', character: 'One land neighbour, three lanes; the sea power' },
  { territoryId: 'tarraconensis', name: 'Hispania', character: 'Richest first ring, lanes to Africa and Sardinia' },
];

/** A unit's pace in simulation units — the same conversion the sim does when it trains one. */
export function speedOf(kind: UnitKindValue): number {
  return Math.max(1, idiv(UNIT_SPECS[kind].speedPerMinute * FP_ONE, TICKS_PER_MINUTE));
}

/**
 * The passable cell nearest a province's centre of mass.
 *
 * Ties keep the lower cell index, so the choice never depends on scan direction. A
 * province with no passable cells is an asset that disagrees with the map document, and
 * is worth failing loudly over rather than quietly opening a match nobody can play.
 */
export function seatCellOf(grid: TerrainGrid, territoryId: string): number {
  const index = grid.provinceIndex(territoryId);
  if (index === 0) throw new Error(`warfront-sim: no province "${territoryId}" in the terrain asset`);

  let sumCol = 0;
  let sumRow = 0;
  let count = 0;
  for (let i = 0; i < grid.size; i++) {
    if (grid.owner(i) !== index || !grid.isPassable(i)) continue;
    sumCol += grid.colOf(i);
    sumRow += grid.rowOf(i);
    count += 1;
  }
  if (count === 0) throw new Error(`warfront-sim: province "${territoryId}" has no passable cells`);

  // Distance to the centroid, with the division multiplied out: comparing
  // (col*count - sumCol)^2 against the same for every candidate orders them exactly as
  // comparing (col - sumCol/count)^2 would, without a float ever existing. At this map's
  // size the largest term is about 3e14, comfortably inside a double's exact range.
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < grid.size; i++) {
    if (grid.owner(i) !== index || !grid.isPassable(i)) continue;
    const dc = grid.colOf(i) * count - sumCol;
    const dr = grid.rowOf(i) * count - sumRow;
    const d = dc * dc + dr * dr;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

export interface OpeningOptions {
  /** How many seats play. Two is Rome against Gaul; four is the full table. */
  seats?: number;
  /** Override the roster, for a matchup the default order does not produce. */
  territoryIds?: readonly string[];
  villagers?: number;
  scouts?: number;
}

export interface Opening {
  scenario: Scenario;
  /** Seat index (1-based) → the province and cell it opened on. */
  seats: Array<{ seat: number; territoryId: string; name: string; cell: number }>;
}

/**
 * Builds a starting position: one seat per player, each with the brief's stock — four
 * villagers, a scout, 200 food and 100 timber — standing on their seat.
 *
 * Seat indices are 1-based and follow the roster order, so seat 1 is always the first
 * entry. Owner 0 is reserved: it is the tribes.
 */
export function buildOpening(grid: TerrainGrid, options: OpeningOptions = {}): Opening {
  const ids = options.territoryIds ?? SEATS.slice(0, Math.max(2, options.seats ?? 4)).map((s) => s.territoryId);
  if (ids.length < 1) throw new Error('warfront-sim: an opening needs at least one seat');

  const villagers = options.villagers ?? START_VILLAGERS;
  const scouts = options.scouts ?? START_SCOUTS;
  const roster: UnitKindValue[] = [
    ...Array.from({ length: villagers }, () => UnitKind.Villager as UnitKindValue),
    ...Array.from({ length: scouts }, () => UnitKind.Scout as UnitKindValue),
  ];

  const seats: Opening['seats'] = [];
  const scenario: Scenario = { units: [], players: [], buildings: [] };

  ids.forEach((territoryId, i) => {
    const seat = i + 1;
    const cell = seatCellOf(grid, territoryId);
    const known = SEATS.find((s) => s.territoryId === territoryId);
    seats.push({ seat, territoryId, name: known?.name ?? territoryId, cell });
    scenario.players!.push({ index: seat, food: START_FOOD, timber: START_TIMBER, silver: START_SILVER });
    scenario.buildings!.push({ owner: seat, kind: BuildingKind.Seat, cell });
    for (const kind of roster) {
      scenario.units.push({
        owner: seat,
        kind,
        x: cellCentre(grid.colOf(cell)),
        y: cellCentre(grid.rowOf(cell)),
        speed: speedOf(kind),
      });
    }
  });

  return { scenario, seats };
}

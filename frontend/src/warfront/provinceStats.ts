/**
 * Per-province terrain facts, computed once when the asset loads.
 *
 * The province panel needs counts — how much of Gaul is forest, how many fords it has,
 * which lanes leave it — and recomputing those on every hover would mean scanning
 * ~600k cells per pointer move. One pass over the grid at load time produces every
 * province's numbers together, which is both faster and simpler than caching per hover.
 */

import { BIOME_NAMES, cellBeach, cellFord, cellPass, type TerrainGrid } from '@borderfall/warfront-sim';

export interface ProvinceStats {
  index: number;
  territoryId: string;
  name: string;
  cells: number;
  passable: number;
  /** Cell count per biome, indexed by the sim's biome value. */
  biomes: number[];
  fords: number;
  beaches: number;
  passes: number;
  /** Highland (tier 1) cell count — the high ground that matters to the rules. */
  highland: number;
  /** territory_ids this province has a sea lane to. */
  lanes: string[];
  /** Cell index nearest the province's centre of mass, for a camera jump. */
  centerCell: number;
}

export function biomeName(biome: number): string {
  return BIOME_NAMES[biome] ?? 'unknown';
}

/** Percentage as a whole number, guarding the empty-province case. */
export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part * 100) / whole);
}

export function computeProvinceStats(grid: TerrainGrid): ProvinceStats[] {
  const byIndex = new Map<number, ProvinceStats>();
  const sums = new Map<number, { col: number; row: number }>();

  for (const p of grid.provinces) {
    byIndex.set(p.index, {
      index: p.index,
      territoryId: p.territory_id,
      name: p.name,
      cells: 0,
      passable: 0,
      biomes: new Array<number>(BIOME_NAMES.length).fill(0),
      fords: 0,
      beaches: 0,
      passes: 0,
      highland: 0,
      lanes: [],
      centerCell: -1,
    });
    sums.set(p.index, { col: 0, row: 0 });
  }

  for (let i = 0; i < grid.size; i++) {
    const owner = grid.owner(i);
    if (owner === 0) continue;
    const stats = byIndex.get(owner);
    if (!stats) continue;
    const value = grid.value(i);
    stats.cells += 1;
    if (grid.isPassable(i)) stats.passable += 1;
    stats.biomes[grid.biome(i)] += 1;
    if (grid.tier(i) === 1) stats.highland += 1;
    if (cellFord(value)) stats.fords += 1;
    if (cellBeach(value)) stats.beaches += 1;
    if (cellPass(value)) stats.passes += 1;
    const sum = sums.get(owner)!;
    sum.col += grid.colOf(i);
    sum.row += grid.rowOf(i);
  }

  // Lanes come straight from the map's own typed sea links, carried in the asset.
  for (const lane of grid.lanes) {
    for (const [from, to] of [
      [lane.from, lane.to],
      [lane.to, lane.from],
    ]) {
      const index = grid.provinceIndex(from);
      const stats = byIndex.get(index);
      if (stats && !stats.lanes.includes(to)) stats.lanes.push(to);
    }
  }

  for (const stats of byIndex.values()) stats.lanes.sort();

  // Centre of mass, then snapped to a real cell of that province: a concave province
  // (Italy, Britannia) can have its centroid out at sea, and a camera jump must land on
  // the province, not next to it.
  //
  // One pass over the grid for ALL provinces, not one pass each: at twenty provinces and
  // ~600k cells the per-province version is twelve million iterations for a number only
  // used to centre the camera.
  const targets = new Map<number, { col: number; row: number }>();
  for (const [index, stats] of byIndex) {
    if (stats.cells === 0) continue;
    const sum = sums.get(index)!;
    targets.set(index, { col: Math.round(sum.col / stats.cells), row: Math.round(sum.row / stats.cells) });
  }
  const best = new Map<number, number>();
  for (let i = 0; i < grid.size; i++) {
    const owner = grid.owner(i);
    if (owner === 0) continue;
    const target = targets.get(owner);
    if (!target) continue;
    const dc = grid.colOf(i) - target.col;
    const dr = grid.rowOf(i) - target.row;
    const d = dc * dc + dr * dr;
    const currentBest = best.get(owner);
    if (currentBest === undefined || d < currentBest) {
      best.set(owner, d);
      byIndex.get(owner)!.centerCell = i;
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

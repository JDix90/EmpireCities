import { assertInt, idiv } from './fixed';
import { StateHasher } from './hash';

/**
 * The cell-grid terrain asset (generated offline by
 * `frontend/scripts/buildWarfrontTerrain.ts`, committed under `database/warfront/`).
 *
 * One uint16 per cell:
 *
 *   bits 0–4   owner      0 = no province; 1..N index into `provinces` (N ≤ 31)
 *   bit  5     tier       elevation tier: 0 lowland, 1 highland
 *   bit  6     passable   land units may enter
 *   bits 7–9   biome      see `Biome`
 *   bit  10    ford       a river cell that can be crossed
 *   bit  11    beach      a coastal lowland cell a convoy can land on
 *   bit  12    pass       a mountain corridor that can be crossed
 *   bits 13–15 reserved   always 0
 *
 * Rows are run-length encoded as `[value, run, value, run, …]` so the JSON diffs and
 * compresses well. Geographic metadata is stored in micro-degrees (integers) — the sim
 * never touches it, but the file keeps to the integer convention anyway so a host can
 * map lon/lat to cells with exact arithmetic.
 */

export const OWNER_MASK = 0x1f;
export const TIER_BIT = 1 << 5;
export const PASSABLE_BIT = 1 << 6;
export const BIOME_SHIFT = 7;
export const BIOME_MASK = 0x7;
export const FORD_BIT = 1 << 10;
export const BEACH_BIT = 1 << 11;
export const PASS_BIT = 1 << 12;
/**
 * Woodland, carried ALONGSIDE the biome rather than as one of its values.
 *
 * A forest and a hill are not alternatives in the world and should not be alternatives
 * here. The pipeline composes a cell by precedence — mountain, desert, river, pass,
 * highland, forest, plains — so before this bit existed, every wooded slope came out as
 * bare highland and its trees were simply lost. Measured on the committed asset: the
 * curated forest mask drew fourteen woods and the composer erased six of them, including
 * ALL of Sila and ALL of Kroumirie, which are the only woodland in Italy and Africa
 * respectively. That left two of the four seats in the roster unable to raise a lumber
 * camp anywhere on the map, and since every building costs timber and only a lumber camp
 * makes any, unable to build anything at all past their opening purse.
 *
 * A bit rather than a `WoodedHighland` biome because the biome is what a cell IS for
 * movement, tier and the high-ground bonus, and a wooded hill is still a hill for every
 * one of those. This is the same shape as `ford`, `beach` and `pass` above: a property
 * the terrain carries in addition to what it is.
 *
 * Set on every cell the curated mask covers, plain forest included, so "can a lumber camp
 * stand here" is ONE test rather than "forest, or highland that happens to be wooded" —
 * two conditions that would eventually disagree.
 */
export const WOODED_BIT = 1 << 13;
export const CELL_MAX = 0x3fff;

export const Biome = {
  Void: 0,
  Sea: 1,
  Plains: 2,
  Forest: 3,
  Highland: 4,
  Mountain: 5,
  River: 6,
  Desert: 7,
} as const;
export type BiomeValue = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: readonly string[] = ['void', 'sea', 'plains', 'forest', 'highland', 'mountain', 'river', 'desert'];

/** Largest grid the flow field's packed heap keys support (index must fit in 21 bits). */
export const MAX_CELLS = 1 << 21;

export interface TerrainProvince {
  index: number;
  territory_id: string;
  name: string;
}

export interface TerrainLane {
  from: string;
  to: string;
}

export interface TerrainBoundsE6 {
  min_lng_e6: number;
  max_lng_e6: number;
  min_lat_e6: number;
  max_lat_e6: number;
}

export interface TerrainAsset {
  format: 'warfront-terrain';
  version: 1;
  map_id: string;
  generator: string;
  cell_km: number;
  width: number;
  height: number;
  /** Grid extent, micro-degrees. Row 0 is the northern edge. */
  bounds_e6: TerrainBoundsE6;
  /** Standard parallel the cell size is true at, micro-degrees. */
  lat0_e6: number;
  provinces: TerrainProvince[];
  /** Typed sea links among the provinces, copied verbatim from the map document. */
  lanes: TerrainLane[];
  rows: number[][];
  /** `terrainChecksum` over width, height and every cell. */
  checksum: string;
}

export function packCell(fields: {
  owner: number;
  tier: 0 | 1;
  passable: boolean;
  biome: BiomeValue;
  ford?: boolean;
  beach?: boolean;
  pass?: boolean;
  wooded?: boolean;
}): number {
  return (
    (fields.owner & OWNER_MASK) |
    (fields.tier ? TIER_BIT : 0) |
    (fields.passable ? PASSABLE_BIT : 0) |
    ((fields.biome & BIOME_MASK) << BIOME_SHIFT) |
    (fields.ford ? FORD_BIT : 0) |
    (fields.beach ? BEACH_BIT : 0) |
    (fields.pass ? PASS_BIT : 0) |
    (fields.wooded ? WOODED_BIT : 0)
  );
}

export function cellOwner(v: number): number {
  return v & OWNER_MASK;
}
export function cellTier(v: number): 0 | 1 {
  return v & TIER_BIT ? 1 : 0;
}
export function cellPassable(v: number): boolean {
  return (v & PASSABLE_BIT) !== 0;
}
export function cellBiome(v: number): BiomeValue {
  return ((v >> BIOME_SHIFT) & BIOME_MASK) as BiomeValue;
}
export function cellFord(v: number): boolean {
  return (v & FORD_BIT) !== 0;
}
export function cellBeach(v: number): boolean {
  return (v & BEACH_BIT) !== 0;
}
export function cellPass(v: number): boolean {
  return (v & PASS_BIT) !== 0;
}
export function cellWooded(v: number): boolean {
  return (v & WOODED_BIT) !== 0;
}

/** Run-length encodes one row per array: `[value, run, value, run, …]`. */
export function encodeTerrainRows(cells: Uint16Array, width: number, height: number): number[][] {
  if (cells.length !== width * height) throw new Error('warfront-sim: cell count does not match width × height');
  const rows: number[][] = [];
  for (let r = 0; r < height; r++) {
    const row: number[] = [];
    const base = r * width;
    let run = 0;
    let value = cells[base];
    for (let c = 0; c < width; c++) {
      const v = cells[base + c];
      if (v === value) {
        run += 1;
      } else {
        row.push(value, run);
        value = v;
        run = 1;
      }
    }
    row.push(value, run);
    rows.push(row);
  }
  return rows;
}

export function decodeTerrainRows(rows: number[][], width: number, height: number): Uint16Array {
  if (rows.length !== height) throw new Error(`warfront-sim: terrain has ${rows.length} rows, expected ${height}`);
  const cells = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) {
    const row = rows[r];
    if (row.length % 2 !== 0) throw new Error(`warfront-sim: terrain row ${r} has an odd run list`);
    let c = 0;
    for (let i = 0; i < row.length; i += 2) {
      const value = assertInt(row[i], `terrain row ${r} value`);
      const run = assertInt(row[i + 1], `terrain row ${r} run`);
      if (value < 0 || value > CELL_MAX) throw new Error(`warfront-sim: terrain row ${r} value ${value} out of range`);
      if (run <= 0 || c + run > width) throw new Error(`warfront-sim: terrain row ${r} overflows width ${width}`);
      cells.fill(value, r * width + c, r * width + c + run);
      c += run;
    }
    if (c !== width) throw new Error(`warfront-sim: terrain row ${r} covers ${c} cells, expected ${width}`);
  }
  return cells;
}

/** Digest of the whole grid; stored in the asset and re-checked on decode. */
export function terrainChecksum(cells: Uint16Array, width: number, height: number): string {
  const h = new StateHasher();
  h.int(width).int(height);
  for (let i = 0; i < cells.length; i++) h.word(cells[i]);
  return h.digest();
}

/**
 * Decoded grid. Cells are addressed by `index = row * width + col`; row 0 is north.
 * Positions in the sim are 16.16 fixed cell units, so cell (col, row) spans
 * x ∈ [col, col + 1), y ∈ [row, row + 1).
 */
export class TerrainGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint16Array;
  readonly provinces: readonly TerrainProvince[];
  readonly lanes: readonly TerrainLane[];
  readonly boundsE6: TerrainBoundsE6 | null;
  readonly cellKm: number;
  private cachedChecksum: string | null = null;

  constructor(
    width: number,
    height: number,
    cells: Uint16Array,
    meta: { provinces?: TerrainProvince[]; lanes?: TerrainLane[]; boundsE6?: TerrainBoundsE6; cellKm?: number } = {},
  ) {
    assertInt(width, 'terrain width');
    assertInt(height, 'terrain height');
    if (width <= 0 || height <= 0) throw new Error('warfront-sim: terrain dimensions must be positive');
    if (width * height > MAX_CELLS) throw new Error(`warfront-sim: terrain exceeds ${MAX_CELLS} cells`);
    if (cells.length !== width * height) throw new Error('warfront-sim: cell count does not match width × height');
    this.width = width;
    this.height = height;
    this.cells = cells;
    this.provinces = meta.provinces ?? [];
    this.lanes = meta.lanes ?? [];
    this.boundsE6 = meta.boundsE6 ?? null;
    this.cellKm = meta.cellKm ?? 0;
  }

  /** Parses and validates a committed asset, including its checksum. */
  static decode(asset: TerrainAsset): TerrainGrid {
    if (asset.format !== 'warfront-terrain' || asset.version !== 1) {
      throw new Error('warfront-sim: not a warfront-terrain v1 asset');
    }
    const cells = decodeTerrainRows(asset.rows, asset.width, asset.height);
    const checksum = terrainChecksum(cells, asset.width, asset.height);
    if (checksum !== asset.checksum) {
      throw new Error(`warfront-sim: terrain checksum mismatch (${checksum} vs ${asset.checksum})`);
    }
    return new TerrainGrid(asset.width, asset.height, cells, {
      provinces: asset.provinces,
      lanes: asset.lanes,
      boundsE6: asset.bounds_e6,
      cellKm: asset.cell_km,
    });
  }

  get size(): number {
    return this.cells.length;
  }

  /** Same digest the asset carries; identifies the grid a replay ran on. */
  checksum(): string {
    if (this.cachedChecksum === null) this.cachedChecksum = terrainChecksum(this.cells, this.width, this.height);
    return this.cachedChecksum;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  colOf(index: number): number {
    return index % this.width;
  }

  rowOf(index: number): number {
    return idiv(index, this.width);
  }

  value(index: number): number {
    return this.cells[index];
  }

  isPassable(index: number): boolean {
    return cellPassable(this.cells[index]);
  }

  owner(index: number): number {
    return cellOwner(this.cells[index]);
  }

  biome(index: number): BiomeValue {
    return cellBiome(this.cells[index]);
  }

  tier(index: number): 0 | 1 {
    return cellTier(this.cells[index]);
  }

  isFord(index: number): boolean {
    return cellFord(this.cells[index]);
  }

  isBeach(index: number): boolean {
    return cellBeach(this.cells[index]);
  }

  isPass(index: number): boolean {
    return cellPass(this.cells[index]);
  }

  /** Trees stand here: the one test for whether a lumber camp can. See `WOODED_BIT`. */
  isWooded(index: number): boolean {
    return cellWooded(this.cells[index]);
  }

  provinceIndex(territoryId: string): number {
    const p = this.provinces.find((x) => x.territory_id === territoryId);
    return p ? p.index : 0;
  }

  /**
   * Column for a longitude in micro-degrees (exact rational arithmetic). Returns -1
   * when the grid carries no bounds or the point is outside it.
   */
  colForLngE6(lngE6: number): number {
    const b = this.boundsE6;
    if (!b) return -1;
    const span = b.max_lng_e6 - b.min_lng_e6;
    const col = idiv((lngE6 - b.min_lng_e6) * this.width, span);
    return col >= 0 && col < this.width ? col : -1;
  }

  /** Row for a latitude in micro-degrees; row 0 is the northern edge. -1 when outside. */
  rowForLatE6(latE6: number): number {
    const b = this.boundsE6;
    if (!b) return -1;
    const span = b.max_lat_e6 - b.min_lat_e6;
    const row = idiv((b.max_lat_e6 - latE6) * this.height, span);
    return row >= 0 && row < this.height ? row : -1;
  }

  /** Cell index for a lon/lat in micro-degrees, or -1 when outside the grid. */
  cellForLngLatE6(lngE6: number, latE6: number): number {
    const col = this.colForLngE6(lngE6);
    const row = this.rowForLatE6(latE6);
    return col < 0 || row < 0 ? -1 : this.index(col, row);
  }

  /**
   * Nearest passable cell to `index` by Chebyshev ring, scanning each ring in a fixed
   * order so the answer is the same everywhere. -1 when none within `maxRadius`.
   */
  nearestPassable(index: number, maxRadius: number): number {
    if (this.isPassable(index)) return index;
    const c0 = this.colOf(index);
    const r0 = this.rowOf(index);
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        if (r < 0 || r >= this.height) continue;
        const edgeRow = r === r0 - radius || r === r0 + radius;
        const step = edgeRow ? 1 : 2 * radius;
        for (let c = c0 - radius; c <= c0 + radius; c += step) {
          if (c < 0 || c >= this.width) continue;
          const i = this.index(c, r);
          if (this.isPassable(i)) return i;
        }
      }
    }
    return -1;
  }
}

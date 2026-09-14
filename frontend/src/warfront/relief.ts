/**
 * Relief fields for the tactical map: elevation, light, water depth and ground grain.
 *
 * The terrain asset is categorical — a cell is plains or mountain, lowland or highland,
 * and nothing in between. Painted straight, that is a flat colour wash: eight shades of
 * poster paint with hard edges, which is what the map looked like before this file. The
 * information is all there, it just has no *form*.
 *
 * So the fields below reconstruct the form the categories imply. A continuous height is
 * assigned per biome, smoothed so a range has flanks rather than a cliff edge, and then
 * lit from the north-west at 45° — the cartographic convention, and the reason a paper
 * atlas reads as landscape while a choropleth does not. Water gets a distance-to-shore
 * gradient so the shelf is legible from the deep. None of it invents geography: every
 * field is a deterministic function of the committed cells, so two players on the same
 * asset see the same map, and re-baking after a pipeline change can only move pixels the
 * pipeline moved.
 *
 * All of it runs ONCE, at load, over ~600k cells, and is then a static texture (see
 * terrainImage.ts). Per-frame cost is zero.
 *
 * NOTE ON FLOATS: presentation only. The integer rule and its lint bind the sim package,
 * which must reproduce a match from a seed; nothing here feeds back into sim state.
 */

import * as sim from '@borderfall/warfront-sim';
import type { BiomeValue, TerrainGrid } from '@borderfall/warfront-sim';

/**
 * Imported names, read once into locals.
 *
 * `@borderfall/warfront-sim` ships CommonJS (`main: ./dist/index.js`, emitted by tsc),
 * and tsc's re-export shim defines each name as a GETTER on the exports object. So under
 * a bundler every *read* of an imported binding is a function call — which is nothing at
 * all until it happens inside a loop over ~600k cells. Profiled on the committed asset,
 * those getters were 85 ms of the bake: more than the shading, the blurs and the four
 * distance transforms put together, spent entirely on fetching constants that never
 * change. Destructured once here; everything below reads plain module-scope values.
 */
const { BIOME_MASK, BIOME_NAMES, BIOME_SHIFT, Biome, PASSABLE_BIT, TIER_BIT, WOODED_BIT } = sim;

/**
 * Elevation per biome, in [0,1].
 *
 * Not metres — a rank the shading can differentiate. The gaps matter more than the
 * values: mountain must stand far enough above highland that the range reads as a wall,
 * and river must sit just below the ground around it so a valley cuts rather than bulges.
 */
export const BIOME_HEIGHT: Record<BiomeValue, number> = {
  [Biome.Void]: 0,
  [Biome.Sea]: 0,
  [Biome.Plains]: 0.3,
  [Biome.Forest]: 0.33,
  [Biome.Highland]: 0.5,
  [Biome.Mountain]: 0.74,
  [Biome.River]: 0.26,
  [Biome.Desert]: 0.28,
};

/** The tier bit is the rules' own "high ground": it should look like it too. */
export const TIER_LIFT = 0.06;

/**
 * Domes: how much higher the middle of a massif sits than its foot, and over how many
 * cells it gets there.
 *
 * Measured on the committed asset, half of all mountain cells and ninety-five percent of
 * all desert cells sat at EXACTLY the biome's own height — the interior of a region is
 * one flat number, so its gradient is zero and the light has nothing to model. The Alps
 * came out as a white plateau with a lit rim. A range is not a plateau: it is broad and
 * convex, highest where it is widest, and distance-to-its-own-edge is that shape almost
 * exactly, for nothing beyond a chamfer sweep already written for the shoreline.
 *
 * Mountain takes both domes, since every mountain cell is also upland.
 */
export const UPLAND_DOME = 0.1;
export const UPLAND_DOME_CELLS = 10;
export const MOUNTAIN_DOME = 0.16;
export const MOUNTAIN_DOME_CELLS = 12;
/**
 * And the gentlest of the three: a continent rises away from its own coast. Small, but it
 * is what stops a thousand cells of inland plain reading as one flat green field.
 */
export const INLAND_RISE = 0.07;
export const INLAND_RISE_CELLS = 45;
/**
 * Impassable lowland is a severed contact, not a mountain — see the blocked-ground note
 * in terrainImage.ts. It gets no lift, so the shading does not invent a ridge along a
 * border the pipeline drew.
 */

/**
 * How broken the ground of each biome is, as a height amplitude.
 *
 * Without this the map has no relief where it most needs it. A range is one flat value
 * across its whole interior, so the gradient inside it is zero and the light finds
 * nothing to catch: the Alps came out as a white blob with a lit rim, which is a plateau,
 * not a mountain range. Roughness is what a summit ridge, a spur and a corrie are —
 * structure BELOW the resolution at which the asset records "mountain".
 *
 * It is invented detail, and it is confined to that role on purpose: it moves the light,
 * never a rule. Nothing a player acts on — passability, tier, the crossings, the province
 * a cell belongs to — reads this field, so an invented ridge can mislead the eye about
 * the shape of a slope but never about whether a unit can walk it.
 */
export const BIOME_ROUGHNESS: Record<BiomeValue, number> = {
  [Biome.Void]: 0,
  [Biome.Sea]: 0,
  [Biome.Plains]: 0.028,
  [Biome.Forest]: 0.034,
  [Biome.Highland]: 0.075,
  [Biome.Mountain]: 0.105,
  [Biome.River]: 0.012,
  [Biome.Desert]: 0.062,
};

/** Box-blur radius and repeats applied to the raw height, in cells. */
export const SMOOTH_RADIUS = 2;
export const SMOOTH_PASSES = 2;
/** The roughness mask is blurred too, so a range's detail fades in at its foot. */
export const ROUGHNESS_RADIUS = 3;
/** Radius of the wide blur the ambient term compares against. */
export const HORIZON_RADIUS = 10;

/** Vertical exaggeration. Real relief at 4 km per cell would be imperceptible. */
export const EXAGGERATION = 14;
/** How hard the light bites. 1 is the physical Lambertian result; more is an atlas. */
export const SHADE_STRENGTH = 1.7;
export const SHADE_MIN = 0.55;
export const SHADE_MAX = 1.42;
/** Valleys darken, shoulders lift — the term that separates a basin from a plateau. */
export const AMBIENT_STRENGTH = 1.1;
export const AMBIENT_MIN = -0.22;
export const AMBIENT_MAX = 0.06;

/** Light from the north-west at 45°: (cos45·−1/√2, cos45·−1/√2, sin45), y running south. */
const LIGHT_X = -0.5;
const LIGHT_Y = -0.5;
const LIGHT_Z = Math.SQRT1_2;
/** What the dot product gives on dead-flat ground; shading is expressed relative to it. */
const FLAT_DOT = LIGHT_Z;

/** How far out to sea the continental shelf fades, in cells. */
export const SHELF_CELLS = 9;

/** Ground grain: two octaves of value noise, lattice spacing in cells. */
export const GRAIN_COARSE = 11;
export const GRAIN_FINE = 4;

/**
 * Ridge detail: three octaves, added AFTER the smoothing rather than before it.
 *
 * Before it, the blur that gives a range its flanks would erase the very detail that
 * makes it a range. Macro form and micro form want opposite filters, so they are made
 * separately and summed.
 */
export const RIDGE_LATTICES: readonly number[] = [13, 6, 3];
export const RIDGE_WEIGHTS: readonly number[] = [0.5, 0.33, 0.17];
/**
 * Half the detail is billowed and half is ridged — `1 − |n|`, which creases where the
 * noise crosses zero.
 *
 * Billow alone is stucco: bumps of the right size in the wrong shape, because a mountain
 * range is made of crests and gullies, not blisters. Ridged alone is all crest and no
 * ground between. The sum has both, and since the amplitude is scaled by the biome's
 * roughness the crests only appear where there is a range to crease.
 */
export const RIDGE_BILLOW_SHARE = 0.45;

/**
 * The two tables above, flattened into typed arrays indexed by biome.
 *
 * `Record<BiomeValue, number>` is the readable form and stays the source of truth, but a
 * property lookup on a plain object, done twice per cell over ~600k cells, is one of the
 * larger costs in the bake. Derived once at module load so the two cannot drift.
 */
/**
 * The cell accessors, read off the packed value here rather than called.
 *
 * `cellBiome` and friends are the readable way to ask a cell what it is, and everywhere
 * else in the app they are the right call. In a loop that runs 600k times and asks four
 * questions of every cell they are not: measured on the committed asset, the four calls
 * cost 58 ms and the same four masks cost 2 ms — the call cannot be inlined across the
 * package boundary, so each one is a namespace lookup and a frame.
 *
 * The MASKS are imported, not copied, so the packed layout still has exactly one
 * definition (see terrain.ts). What is local is only the decision to write it out.
 */
const HEIGHT_BY_BIOME = Float64Array.from(BIOME_NAMES.map((_, b) => BIOME_HEIGHT[b as BiomeValue] ?? 0));
const ROUGH_BY_BIOME = Float64Array.from(BIOME_NAMES.map((_, b) => BIOME_ROUGHNESS[b as BiomeValue] ?? 0));

export interface ReliefFields {
  /** Elevation in [0,1]: the smoothed biome form plus its ridge detail. */
  height: Float32Array;
  /**
   * The same elevation WITHOUT ridge detail.
   *
   * The snowline reads this. Run against `height`, a snowline follows every invented
   * ridge and the treeline comes out as speckle; run against the macro form it is a
   * contour, which is what a snowline is.
   */
  macro: Float32Array;
  /** Light multiplier about 1: above on a slope facing the light, below on one turned away. */
  shade: Float32Array;
  /** 0 at the shoreline rising to 1 in open water. Meaningless on land. */
  depth: Float32Array;
  /** Distance to the nearest sea cell, in cells. Meaningless at sea. */
  shore: Float32Array;
  /**
   * Distance into woodland from its own edge, in cells. 0 on open ground.
   *
   * The wood mask is hand-curated as polygons, so a wood's outline is whatever shape was
   * drawn — and several of them were drawn as rectangles. A canopy that steps from open
   * plain to full forest across one cell boundary makes that rectangle the loudest thing
   * on the map. This field lets the painter feather the canopy inward from its rim, which
   * breaks the straight edge without moving it: see WOOD_RIM_FLOOR in terrainImage.ts.
   */
  wood: Float32Array;
  /** Soft mottling in about [-1,1] — ground variation, not static. */
  grain: Float32Array;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Separable box blur with a running sum, edges clamped. Two of these approximate a
 * Gaussian closely enough for shading and cost one add and one subtract per cell.
 */
export function boxBlur(field: Float32Array, scratch: Float32Array, width: number, height: number, radius: number): void {
  if (radius < 1) return;
  const span = radius * 2 + 1;

  for (let row = 0; row < height; row++) {
    const base = row * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += field[base + clamp(k, 0, width - 1)];
    scratch[base] = sum / span;
    for (let col = 1; col < width; col++) {
      sum += field[base + Math.min(col + radius, width - 1)];
      sum -= field[base + Math.max(col - radius - 1, 0)];
      scratch[base + col] = sum / span;
    }
  }

  for (let col = 0; col < width; col++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += scratch[clamp(k, 0, height - 1) * width + col];
    field[col] = sum / span;
    for (let row = 1; row < height; row++) {
      sum += scratch[Math.min(row + radius, height - 1) * width + col];
      sum -= scratch[Math.max(row - radius - 1, 0) * width + col];
      field[row * width + col] = sum / span;
    }
  }
}

const DIAGONAL = Math.SQRT2;

/**
 * Chamfer distance, in cells, from every cell to the nearest seed.
 *
 * Two sweeps rather than a queue: the exact Euclidean transform is not worth its code
 * here, and a 3×3 chamfer is within a few percent of it — well inside what a shoreline
 * gradient needs.
 */
export function chamferDistance(seed: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = seed[i] ? 0 : far;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      let best = dist[i];
      if (best === 0) continue;
      if (col > 0) best = Math.min(best, dist[i - 1] + 1);
      if (row > 0) {
        best = Math.min(best, dist[i - width] + 1);
        if (col > 0) best = Math.min(best, dist[i - width - 1] + DIAGONAL);
        if (col + 1 < width) best = Math.min(best, dist[i - width + 1] + DIAGONAL);
      }
      dist[i] = best;
    }
  }

  for (let row = height - 1; row >= 0; row--) {
    for (let col = width - 1; col >= 0; col--) {
      const i = row * width + col;
      let best = dist[i];
      if (best === 0) continue;
      if (col + 1 < width) best = Math.min(best, dist[i + 1] + 1);
      if (row + 1 < height) {
        best = Math.min(best, dist[i + width] + 1);
        if (col + 1 < width) best = Math.min(best, dist[i + width + 1] + DIAGONAL);
        if (col > 0) best = Math.min(best, dist[i + width - 1] + DIAGONAL);
      }
      dist[i] = best;
    }
  }

  return dist;
}

/** Deterministic per-lattice-point value in [0,1). No clock, no Math.random. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * One octave of value noise: a random lattice, smoothstep-interpolated, in [0,1).
 *
 * Not white noise per cell. The texture is drawn NEAREST so a cell is a hard square when
 * zoomed in, and per-cell noise at that scale is television static. Interpolating a
 * coarse lattice gives mottling at the scale of a landscape instead.
 *
 * The lattice is drawn once into a small array rather than hashed four times per cell:
 * at ~600k cells and three octaves that difference is several million hash rounds on the
 * main thread while the player waits for the map.
 */
export function valueNoise(width: number, height: number, lattice: number, seed: number): Float32Array {
  const gw = Math.floor(width / lattice) + 2;
  const gh = Math.floor(height / lattice) + 2;
  const grid = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) grid[y * gw + x] = hash2(x, y, seed);

  const out = new Float32Array(width * height);
  // Row weights are the same for every column, so they are computed once per row.
  for (let row = 0; row < height; row++) {
    const gy = Math.floor(row / lattice);
    const fy = smoothstep((row % lattice) / lattice);
    const top = gy * gw;
    const bottom = (gy + 1) * gw;
    const base = row * width;
    for (let col = 0; col < width; col++) {
      const gx = Math.floor(col / lattice);
      const fx = smoothstep((col % lattice) / lattice);
      const a = grid[top + gx];
      const b = grid[top + gx + 1];
      const c = grid[bottom + gx];
      const d = grid[bottom + gx + 1];
      const upper = a + (b - a) * fx;
      const lower = c + (d - c) * fx;
      out[base + col] = upper + (lower - upper) * fy;
    }
  }
  return out;
}

/**
 * Several octaves of `valueNoise`, summed and centred on 0.
 *
 * `billow` is the share of each octave kept as plain noise; the rest is ridged — the
 * octave folded about zero so it creases where it changes sign. See RIDGE_BILLOW_SHARE.
 */
export function octaveNoise(
  width: number,
  height: number,
  lattices: readonly number[],
  weights: readonly number[],
  seed: number,
  billow = 1,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let k = 0; k < lattices.length; k++) {
    const octave = valueNoise(width, height, lattices[k], seed + k * 0x9e3779b1);
    const weight = weights[k] ?? 0;
    for (let i = 0; i < out.length; i++) {
      const signed = (octave[i] - 0.5) * 2;
      // `1 − |signed|` runs 0..1 with a crest at the zero crossing; recentre it so the
      // ridged half adds crests without also raising the whole field.
      const ridged = (1 - Math.abs(signed) - 0.5) * 2;
      out[i] += (signed * billow + ridged * (1 - billow)) * weight;
    }
  }
  return out;
}

/** Every field the painter needs, in one pass set over the grid. */
export function computeRelief(grid: TerrainGrid): ReliefFields {
  const { width, height: rows } = grid;
  const size = width * rows;

  const cells = grid.cells;
  const macro = new Float32Array(size);
  const rough = new Float32Array(size);
  const isSea = new Uint8Array(size);
  const isLand = new Uint8Array(size);
  const notUpland = new Uint8Array(size);
  const notMountain = new Uint8Array(size);
  const notWooded = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const value = cells[i];
    const biome = (value >> BIOME_SHIFT) & BIOME_MASK;
    const water = biome === Biome.Sea || biome === Biome.Void;
    const upland = biome === Biome.Highland || biome === Biome.Mountain;
    isSea[i] = water ? 1 : 0;
    isLand[i] = water ? 0 : 1;
    notUpland[i] = upland ? 0 : 1;
    notMountain[i] = biome === Biome.Mountain ? 0 : 1;
    notWooded[i] = (value & WOODED_BIT) !== 0 ? 0 : 1;
    // The tier lift is the rules' high ground; blocked lowland gets none, so a severed
    // land contact does not sprout a ridge that is not there.
    const lift = (value & TIER_BIT) !== 0 && (value & PASSABLE_BIT) !== 0 ? TIER_LIFT : 0;
    macro[i] = water ? 0 : HEIGHT_BY_BIOME[biome] + lift;
    rough[i] = ROUGH_BY_BIOME[biome];
  }

  // Distance fields. `shore` is a shoreline for the painter and a continental rise here;
  // the other three exist only to dome the land (see UPLAND_DOME).
  const toLand = chamferDistance(isLand, width, rows);
  const shore = chamferDistance(isSea, width, rows);
  const intoUpland = chamferDistance(notUpland, width, rows);
  const intoMountain = chamferDistance(notMountain, width, rows);
  const wood = chamferDistance(notWooded, width, rows);

  for (let i = 0; i < size; i++) {
    if (!isLand[i]) continue;
    macro[i] += INLAND_RISE * Math.min(1, shore[i] / INLAND_RISE_CELLS);
    if (intoUpland[i] > 0) macro[i] += UPLAND_DOME * Math.min(1, intoUpland[i] / UPLAND_DOME_CELLS);
    if (intoMountain[i] > 0) macro[i] += MOUNTAIN_DOME * Math.min(1, intoMountain[i] / MOUNTAIN_DOME_CELLS);
  }

  const scratch = new Float32Array(size);
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) boxBlur(macro, scratch, width, rows, SMOOTH_RADIUS);
  boxBlur(rough, scratch, width, rows, ROUGHNESS_RADIUS);

  // Macro form + micro form. See RIDGE_LATTICES for why they are made separately.
  const ridge = octaveNoise(width, rows, RIDGE_LATTICES, RIDGE_WEIGHTS, 0x5f3a, RIDGE_BILLOW_SHARE);
  const height = new Float32Array(size);
  for (let i = 0; i < size; i++) height[i] = macro[i] + ridge[i] * rough[i];

  // The horizon: the same height seen from far enough away that only the massif remains.
  // Ground below its own horizon is in a bowl and loses sky; ground above it catches more.
  const horizon = Float32Array.from(macro);
  boxBlur(horizon, scratch, width, rows, HORIZON_RADIUS);

  const shade = new Float32Array(size);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const west = height[col > 0 ? i - 1 : i];
      const east = height[col + 1 < width ? i + 1 : i];
      const north = height[row > 0 ? i - width : i];
      const south = height[row + 1 < rows ? i + width : i];
      const dzdx = (east - west) * 0.5 * EXAGGERATION;
      const dzdy = (south - north) * 0.5 * EXAGGERATION;
      // Surface normal (−dz/dx, −dz/dy, 1), normalised, dotted with the light.
      const inverse = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const lit = (-dzdx * LIGHT_X - dzdy * LIGHT_Y + LIGHT_Z) * inverse;
      const ambient = clamp((macro[i] - horizon[i]) * AMBIENT_STRENGTH, AMBIENT_MIN, AMBIENT_MAX);
      shade[i] = clamp(1 + (lit - FLAT_DOT) * SHADE_STRENGTH + ambient, SHADE_MIN, SHADE_MAX);
    }
  }

  const depth = new Float32Array(size);
  for (let i = 0; i < size; i++) depth[i] = isSea[i] ? Math.min(1, toLand[i] / SHELF_CELLS) : 0;

  const coarse = valueNoise(width, rows, GRAIN_COARSE, 0x9e37);
  const fine = valueNoise(width, rows, GRAIN_FINE, 0x85eb);
  const grain = new Float32Array(size);
  for (let i = 0; i < size; i++) grain[i] = (coarse[i] - 0.5) * 1.3 + (fine[i] - 0.5) * 0.7;

  return { height, macro, shade, depth, shore, wood, grain };
}

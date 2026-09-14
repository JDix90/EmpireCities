/**
 * Warfront terrain → an RGBA image, one pixel per cell.
 *
 * The western-twenty grid is ~600k cells. Drawing each as a PixiJS Graphics rect would
 * be hopeless, so the whole map is baked ONCE into a texture the size of the grid and
 * shown as a single sprite; panning and zooming are then just a sprite transform, and
 * nearest-neighbour scaling keeps cells crisp when zoomed in.
 *
 * Colour is built in layers, and the order is the point:
 *
 *   1. the biome's own colour — what a cell IS
 *   2. what it also carries: woodland, snow on a summit, sand on a beach
 *   3. the crossings, which replace rather than tint, because a ford and a pass are the
 *      only way through and must never be a shade of the thing they cut
 *   4. ground grain, so a province of plains is a landscape and not a swatch
 *   5. the light (see relief.ts), which is what turns the categories into terrain
 *   6. the marks a player reads rather than looks at: blocked ground, the shoreline,
 *      province borders
 *
 * Layer 5 is deliberately late and layer 6 deliberately after it. Shading a border line
 * would make a border fade in and out along its length depending on which way the ground
 * happens to face, and a border the player cannot trust is worse than no border.
 *
 * NOTE ON FLOATS: this is presentation, not simulation. The integer-only rule and its
 * lint (see packages/warfront-sim/README.md) bind the sim package, which is what must
 * reproduce a match from a seed. Nothing here feeds back into simulation state.
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
const {
  BEACH_BIT,
  BIOME_MASK,
  BIOME_NAMES,
  BIOME_SHIFT,
  Biome,
  FORD_BIT,
  PASSABLE_BIT,
  PASS_BIT,
  WOODED_BIT,
  cellBeach,
  cellBiome,
  cellFord,
  cellOwner,
  cellPass,
  cellPassable,
  cellWooded,
} = sim;
import { SHELF_CELLS, computeRelief, type ReliefFields } from './relief';

export type Rgb = readonly [number, number, number];

/**
 * Base colour per biome, before light.
 *
 * Muted on purpose. These are the flat, unlit values, and everything that gives the map
 * its contrast — relief, depth, grain — is a multiplier on top; a palette already at full
 * saturation has nowhere left to go when the light hits it, which is exactly how the
 * first version of this map ended up looking like painted card. Land runs warm and water
 * cool so the coastline reads as a temperature change as well as a value one, and the
 * four things a player must never confuse — water, walkable ground, blocked ground and
 * the crossings through it — stay separable in greyscale.
 */
export const BIOME_COLORS: Record<BiomeValue, Rgb> = {
  [Biome.Void]: [24, 28, 35],
  [Biome.Sea]: [34, 78, 112],
  [Biome.Plains]: [118, 133, 84],
  [Biome.Forest]: [58, 86, 58],
  [Biome.Highland]: [150, 130, 96],
  [Biome.Mountain]: [104, 99, 96],
  [Biome.River]: [56, 106, 152],
  [Biome.Desert]: [188, 164, 119],
};

/** Shallow water, at the shoreline. `BIOME_COLORS[Sea]` is the shelf; this is the deep. */
export const DEEP_SEA: Rgb = [11, 28, 49];
/** The lift on the last cell of water before land: a shoreline, not a colour boundary. */
export const SURF: Rgb = [104, 148, 176];
export const SURF_CELLS = 1.5;
export const SURF_STRENGTH = 0.17;
/** And the land side of the same line, so a coast has an edge at every zoom. */
export const SHORE_INK: Rgb = [36, 44, 46];
export const SHORE_CELLS = 1.2;
export const SHORE_STRENGTH = 0.22;

/** A ford is the only way across a river, so it gets its own colour rather than a tint. */
export const FORD_COLOR: Rgb = [214, 184, 102];
/** A pass is the only way through a barrier range; same reasoning. */
export const PASS_COLOR: Rgb = [150, 116, 174];
/**
 * Crossings are lit at reduced strength. Unlit they look pasted onto the map; fully lit,
 * a one-cell ford on a shadowed slope goes as dark as the river it crosses.
 */
export const CROSSING_SHADE = 0.35;

/**
 * Wooded ground that is not the forest biome — a wooded hill — is tinted toward the
 * forest green rather than recoloured.
 *
 * Tinted because it is BOTH things and the player needs both: it is highland for movement
 * and the archer's high ground, and it is the only ground a lumber camp can stand on.
 * Recolouring it green would hide the hill; leaving it bare hides the timber, which is
 * what the map did while the composer was erasing every upland wood.
 */
export const WOODED_TINT = 0.45;
/** How far the ground grain moves that tint, as a fraction of it. */
export const WOODED_VARIANCE = 0.28;
/**
 * The canopy feathers in over its first few cells rather than starting at full depth.
 *
 * The wood mask is drawn by hand as polygons and several of them are rectangles; at one
 * flat tint the eye reads the rectangle before it reads the wood. Feathering the rim
 * breaks that step WITHOUT moving the boundary: the outermost wooded cell still carries
 * most of the tint (`WOOD_RIM_FLOOR`), so every cell a lumber camp may stand on is still
 * visibly green, and the cell readout is exact either way.
 */
export const WOOD_FEATHER_CELLS = 5;
export const WOOD_RIM_FLOOR = 0.42;
/** How far the grain may wander the feather's contour, in cells. */
export const WOOD_EDGE_WANDER = 1.6;

/** Beaches are a landing surface, not a separate terrain: sand blended into the base. */
export const BEACH_SAND: Rgb = [214, 199, 156];
export const BEACH_BLEND = 0.42;

/**
 * Summits take snow, by height rather than by biome, so a range has a snowline instead
 * of an outline. Read off the macro height (see relief.ts) — against the detailed one a
 * snowline follows every invented ridge and comes out as speckle.
 */
export const SNOW: Rgb = [206, 216, 229];
export const SNOW_START = 0.95;
export const SNOW_FULL = 1.1;

/**
 * Sunlight is warm and shadow is the blue of the sky that fills it.
 *
 * A hillshade applied as a plain multiplier gives a photocopy: every surface the same
 * hue, lighter here and darker there. Real ground lit by a low sun is two lights, and
 * splitting them is most of the difference between shaded relief that looks printed and
 * shaded relief that looks like ground. Kept small — these are a tint on the biome's
 * colour, not a replacement for it.
 */
export const SUN_TINT: Rgb = [255, 238, 198];
export const SUN_TINT_STRENGTH = 0.42;
export const SHADOW_TINT: Rgb = [46, 62, 98];
export const SHADOW_TINT_STRENGTH = 0.36;

/** How much the ground grain (relief.ts) moves a colour, as a fraction. */
export const GRAIN_STRENGTH = 0.055;
/** Water is smoother than ground and reads worse for being speckled. */
export const GRAIN_STRENGTH_WATER = 0.02;
/** Open water is nearly flat, so the light on it is a sheen, not relief. */
export const WATER_SHADE = 0.25;

/** Province borders are drawn in ink rather than by darkening the ground. */
export const BORDER_INK: Rgb = [10, 13, 18];
export const BORDER_STRENGTH = 0.52;

/**
 * Walkable-looking ground that cannot actually be walked.
 *
 * Mountain, desert and sea already read as blocked by their own colour, but plains,
 * forest and highland do not — and the asset contains impassable cells of all three where
 * the terrain pipeline severs a contact the map's connection graph does not call a land
 * border (Britannia's polygon spilling onto Normandy, and nine more like it). Without
 * this, a player would see open ground their units silently refuse to cross, which reads
 * as a bug rather than a border.
 *
 * Toward slate rather than toward black: a darkened green is still green and still looks
 * like a field at dusk. Draining the colour out of it is what says "dead ground".
 */
export const BLOCKED_SLATE: Rgb = [42, 47, 54];
export const BLOCKED_BLEND = 0.62;
/** Biomes whose colour would otherwise promise a walk. */
export const WALKABLE_LOOKING: ReadonlySet<number> = new Set<number>([Biome.Plains, Biome.Forest, Biome.Highland]);

/**
 * The palette and the walkable-looking set, flattened into lookups indexed by biome.
 *
 * The tables above are the readable form and stay the source of truth; these are what the
 * bake reads. A property lookup on a plain object and a `Set.has` are each cheap once and
 * neither is cheap six hundred thousand times, which is how often the painter does them.
 * Derived at module load so they cannot drift from the tables they come from.
 */
const BIOME_RGB = Float64Array.from(
  BIOME_NAMES.flatMap((_, b) => [...(BIOME_COLORS[b as BiomeValue] ?? BIOME_COLORS[Biome.Void])]),
);
const LOOKS_WALKABLE = Uint8Array.from(BIOME_NAMES.map((_, b) => (WALKABLE_LOOKING.has(b) ? 1 : 0)));

/**
 * Inside the bake, a cell is unpacked with the imported MASKS rather than the imported
 * accessors. Six questions per cell over 600k cells is six hundred thousand frames the
 * compiler cannot inline across the package boundary; the same masks are free. The
 * layout still lives in exactly one place — see the same note in relief.ts.
 *
 * `colorForCell` keeps the accessors: it is the single-cell, documentary path.
 */

export interface TerrainImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/**
 * Colour is carried in a three-slot scratch rather than returned as a tuple.
 *
 * The painter blends five or six times per cell over ~600k cells, so a tuple returned
 * from each of those is three million short-lived arrays. Measured, that is not the
 * dominant cost — the per-cell table lookups were — but it is real and it is free to
 * avoid. Everything below writes into `out`; `colorForCell` is the allocating wrapper,
 * for callers that want one cell rather than a map of them.
 */
type Slots = Float64Array;

function setInto(out: Slots, c: Rgb): void {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
}

/** The same, straight out of the flat palette. */
function setBiome(out: Slots, biome: number): void {
  const p = biome * 3;
  out[0] = BIOME_RGB[p];
  out[1] = BIOME_RGB[p + 1];
  out[2] = BIOME_RGB[p + 2];
}

function mixBiome(out: Slots, biome: number, t: number): void {
  const p = biome * 3;
  out[0] += (BIOME_RGB[p] - out[0]) * t;
  out[1] += (BIOME_RGB[p + 1] - out[1]) * t;
  out[2] += (BIOME_RGB[p + 2] - out[2]) * t;
}

function mixInto(out: Slots, b: Rgb, t: number): void {
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
}

/** 0 below `lo`, 1 above `hi`, smooth between — used for treelines and shelves. */
function ramp(value: number, lo: number, hi: number): number {
  if (hi <= lo) return value >= hi ? 1 : 0;
  const t = (value - lo) / (hi - lo);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** The unlit colour of one cell, written into `out`. See `colorForCell`. */
function paintBase(out: Slots, value: number, biome: number, grain: number, canopy: number): void {
  if ((value & FORD_BIT) !== 0) {
    setInto(out, FORD_COLOR);
    return;
  }
  if ((value & PASS_BIT) !== 0) {
    setInto(out, PASS_COLOR);
    return;
  }
  setBiome(out, biome);
  // Trees over ground that is not already forest-coloured: mix toward the forest green so
  // a wooded hill reads as both the hill it is and the timber it holds. The depth of the
  // tint varies with the ground grain and fades toward the wood's rim, which gives a
  // canopy instead of a flat swatch — see WOOD_FEATHER_CELLS. Both only ever scale a
  // tint that is already there, so the boundary stays exactly where the build rule is.
  if ((value & WOODED_BIT) !== 0 && biome !== Biome.Forest) {
    mixBiome(out, Biome.Forest, WOODED_TINT * canopy * (1 + grain * WOODED_VARIANCE));
  }
  if ((value & BEACH_BIT) !== 0) mixInto(out, BEACH_SAND, BEACH_BLEND);
  if (LOOKS_WALKABLE[biome] === 1 && (value & PASSABLE_BIT) === 0) mixInto(out, BLOCKED_SLATE, BLOCKED_BLEND);
}

/**
 * The unlit colour of a single packed cell: everything the cell value alone decides.
 *
 * Light, water depth, the shoreline and province borders are NOT here — they need the
 * cell's neighbours, which a lone value has not got. This is the base the painter lights.
 */
export function colorForCell(value: number, grain = 0, canopy = 1): Rgb {
  const out = new Float64Array(3);
  // The accessors, deliberately: this path runs once, and it is the one a reader checks
  // the bake against. `cellFord`/`cellPass` before the biome, as the painter does.
  if (cellFord(value)) return FORD_COLOR;
  if (cellPass(value)) return PASS_COLOR;
  setBiome(out, cellBiome(value));
  if (cellWooded(value) && cellBiome(value) !== Biome.Forest) {
    mixBiome(out, Biome.Forest, WOODED_TINT * canopy * (1 + grain * WOODED_VARIANCE));
  }
  if (cellBeach(value)) mixInto(out, BEACH_SAND, BEACH_BLEND);
  if (WALKABLE_LOOKING.has(cellBiome(value)) && !cellPassable(value)) mixInto(out, BLOCKED_SLATE, BLOCKED_BLEND);
  return [clamp255(out[0]), clamp255(out[1]), clamp255(out[2])];
}

/**
 * Bakes the grid into an RGBA buffer. Row 0 is north, matching the asset, so the image
 * can be shown without flipping and cell (col,row) is pixel (col,row).
 *
 * Borders are drawn only between two DIFFERENT owned provinces. A province against the
 * sea already reads from the colour change, and outlining every coastline turned the
 * Mediterranean into noise.
 *
 * `relief` is injectable so a test can paint against a known light instead of
 * re-deriving one; production passes nothing and gets the grid's own fields.
 */
export function buildTerrainImage(grid: TerrainGrid, relief: ReliefFields = computeRelief(grid)): TerrainImage {
  const { width, height } = grid;
  const rgba = new Uint8Array(width * height * 4);
  const color = new Float64Array(3);
  const cells = grid.cells;
  const { depth, grain: grainField, macro, shade, shore, wood } = relief;

  for (let i = 0; i < cells.length; i++) {
    const value = cells[i];
    const biome = (value >> BIOME_SHIFT) & BIOME_MASK;
    const water = biome === Biome.Sea || biome === Biome.Void;
    const crossing = (value & (FORD_BIT | PASS_BIT)) !== 0;
    const grain = grainField[i];

    if (biome === Biome.Sea) {
      // Depth first, then the shoreline lift on top of it, so the surf sits on the shelf.
      setBiome(color, Biome.Sea);
      mixInto(color, DEEP_SEA, depth[i]);
      // `depth` is normalised over the shelf; undo that to get back to cells from shore.
      const surf = 1 - ramp(depth[i] * SHELF_CELLS, 0, SURF_CELLS);
      if (surf > 0) mixInto(color, SURF, surf * SURF_STRENGTH);
    } else {
      const rim = wood[i] + grain * WOOD_EDGE_WANDER;
      const canopy = WOOD_RIM_FLOOR + (1 - WOOD_RIM_FLOOR) * ramp(rim, 0, WOOD_FEATHER_CELLS);
      paintBase(color, value, biome, grain, canopy);
      if (biome === Biome.Mountain && !crossing) {
        mixInto(color, SNOW, ramp(macro[i], SNOW_START, SNOW_FULL));
      }
      // The land side of the shoreline. The sea's side is the surf above; this is its edge.
      const edge = 1 - ramp(shore[i], 0, SHORE_CELLS);
      if (edge > 0) mixInto(color, SHORE_INK, edge * SHORE_STRENGTH);
    }

    // Grain under the light rather than over it: a shadowed slope should show less of its
    // ground texture, not the same amount at a lower brightness.
    const texture = 1 + grain * (water ? GRAIN_STRENGTH_WATER : GRAIN_STRENGTH);
    const strength = water ? WATER_SHADE : crossing ? CROSSING_SHADE : 1;
    const light = 1 + (shade[i] - 1) * strength;

    // Two lights: warm toward the sun, cool into the shadow. See SUN_TINT.
    if (light > 1) mixInto(color, SUN_TINT, (light - 1) * SUN_TINT_STRENGTH);
    else if (light < 1) mixInto(color, SHADOW_TINT, (1 - light) * SHADOW_TINT_STRENGTH);

    const factor = texture * light;
    const p = i * 4;
    rgba[p] = clamp255(color[0] * factor);
    rgba[p + 1] = clamp255(color[1] * factor);
    rgba[p + 2] = clamp255(color[2] * factor);
    rgba[p + 3] = 255;
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const owner = cellOwner(grid.value(i));
      if (owner === 0) continue;
      const rightDiffers = col + 1 < width && cellOwner(grid.value(i + 1)) !== owner && cellOwner(grid.value(i + 1)) !== 0;
      const downDiffers =
        row + 1 < height && cellOwner(grid.value(i + width)) !== owner && cellOwner(grid.value(i + width)) !== 0;
      if (!rightDiffers && !downDiffers) continue;
      const p = i * 4;
      rgba[p] = clamp255(rgba[p] + (BORDER_INK[0] - rgba[p]) * BORDER_STRENGTH);
      rgba[p + 1] = clamp255(rgba[p + 1] + (BORDER_INK[1] - rgba[p + 1]) * BORDER_STRENGTH);
      rgba[p + 2] = clamp255(rgba[p + 2] + (BORDER_INK[2] - rgba[p + 2]) * BORDER_STRENGTH);
    }
  }

  return { rgba, width, height };
}

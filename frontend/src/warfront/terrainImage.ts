/**
 * Warfront terrain → an RGBA image, one pixel per cell.
 *
 * The western-twenty grid is ~600k cells. Drawing each as a PixiJS Graphics rect would
 * be hopeless, so the whole map is baked ONCE into a texture the size of the grid and
 * shown as a single sprite; panning and zooming are then just a sprite transform, and
 * nearest-neighbour scaling keeps cells crisp when zoomed in.
 *
 * NOTE ON FLOATS: this is presentation, not simulation. The integer-only rule and its
 * lint (see packages/warfront-sim/README.md) bind the sim package, which is what must
 * reproduce a match from a seed. Nothing here feeds back into simulation state.
 */

import {
  Biome,
  cellBeach,
  cellBiome,
  cellFord,
  cellOwner,
  cellPass,
  cellPassable,
  cellWooded,
  type BiomeValue,
  type TerrainGrid,
} from '@borderfall/warfront-sim';

export type Rgb = readonly [number, number, number];

/**
 * Base colour per biome. Chosen to read on the app's dark chrome and to keep the four
 * things a player must distinguish at a glance separable: water, walkable ground,
 * blocked ground, and the crossings through it.
 */
export const BIOME_COLORS: Record<BiomeValue, Rgb> = {
  [Biome.Void]: [58, 63, 69],
  [Biome.Sea]: [22, 50, 79],
  [Biome.Plains]: [111, 143, 74],
  [Biome.Forest]: [60, 95, 49],
  [Biome.Highland]: [138, 122, 82],
  [Biome.Mountain]: [207, 211, 214],
  [Biome.River]: [47, 111, 176],
  [Biome.Desert]: [184, 163, 112],
};

/** A ford is the only way across a river, so it gets its own colour rather than a tint. */
export const FORD_COLOR: Rgb = [227, 192, 74];

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
/** A pass is the only way through a barrier range; same reasoning. */
export const PASS_COLOR: Rgb = [168, 111, 208];
/** Beaches are a landing surface, not a separate terrain: a lift of the base colour. */
export const BEACH_LIFT = 26;
/** Province borders darken the base colour rather than overprint a line. */
export const BORDER_DARKEN = 0.55;
/**
 * Walkable-looking ground that cannot actually be walked.
 *
 * Mountain, desert and sea already read as blocked by their own colour, but plains,
 * forest and highland do not — and the asset contains impassable cells of all three where
 * the terrain pipeline severs a contact the map's connection graph does not call a land
 * border (Britannia's polygon spilling onto Normandy, and nine more like it). Without
 * this, a player would see open ground their units silently refuse to cross, which reads
 * as a bug rather than a border.
 */
export const BLOCKED_DARKEN = 0.42;
/** Biomes whose colour would otherwise promise a walk. */
const WALKABLE_LOOKING: ReadonlySet<number> = new Set<number>([Biome.Plains, Biome.Forest, Biome.Highland]);

export interface TerrainImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/** The colour a single packed cell value paints, before province borders. */
export function colorForCell(value: number): Rgb {
  if (cellFord(value)) return FORD_COLOR;
  if (cellPass(value)) return PASS_COLOR;
  const biome = cellBiome(value);
  const plain = BIOME_COLORS[biome] ?? BIOME_COLORS[Biome.Void];
  // Trees over ground that is not already forest-coloured: mix toward the forest green so
  // a wooded hill reads as both the hill it is and the timber it holds.
  const base: Rgb =
    cellWooded(value) && biome !== Biome.Forest
      ? [
          clamp255(plain[0] + (BIOME_COLORS[Biome.Forest][0] - plain[0]) * WOODED_TINT),
          clamp255(plain[1] + (BIOME_COLORS[Biome.Forest][1] - plain[1]) * WOODED_TINT),
          clamp255(plain[2] + (BIOME_COLORS[Biome.Forest][2] - plain[2]) * WOODED_TINT),
        ]
      : plain;
  if (!cellPassable(value) && WALKABLE_LOOKING.has(biome)) {
    return [
      clamp255(base[0] * BLOCKED_DARKEN),
      clamp255(base[1] * BLOCKED_DARKEN),
      clamp255(base[2] * BLOCKED_DARKEN),
    ];
  }
  if (cellBeach(value)) {
    return [clamp255(base[0] + BEACH_LIFT), clamp255(base[1] + BEACH_LIFT), clamp255(base[2] + BEACH_LIFT)];
  }
  return base;
}

/**
 * Bakes the grid into an RGBA buffer. Row 0 is north, matching the asset, so the image
 * can be shown without flipping and cell (col,row) is pixel (col,row).
 *
 * Borders are drawn only between two DIFFERENT owned provinces. A province against the
 * sea already reads from the colour change, and outlining every coastline turned the
 * Mediterranean into noise.
 */
export function buildTerrainImage(grid: TerrainGrid): TerrainImage {
  const { width, height } = grid;
  const rgba = new Uint8Array(width * height * 4);

  for (let i = 0; i < grid.size; i++) {
    const [r, g, b] = colorForCell(grid.value(i));
    const p = i * 4;
    rgba[p] = r;
    rgba[p + 1] = g;
    rgba[p + 2] = b;
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
      rgba[p] = clamp255(rgba[p] * BORDER_DARKEN);
      rgba[p + 1] = clamp255(rgba[p + 1] * BORDER_DARKEN);
      rgba[p + 2] = clamp255(rgba[p + 2] * BORDER_DARKEN);
    }
  }

  return { rgba, width, height };
}

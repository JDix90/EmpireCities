/**
 * Shared region color palette used by GameMap (PixiJS), GlobeMap, and TerritoryPanel.
 *
 * Colors are deliberately distinct from player colors (red, blue, green, yellow,
 * purple, teal, orange, white) and from each other, and remain legible on both
 * the dark globe surface and the dark 2-D canvas background.
 *
 * Color assignment is stable as long as mapData.regions preserves insertion order
 * (the server guarantees this from the MongoDB document).
 */

/** CSS hex strings — used by GlobeMap (polygonStrokeColor, htmlElementsData) and TerritoryPanel. */
export const REGION_CSS_COLORS: readonly string[] = [
  '#5b9bd5', // steel blue
  '#70ad47', // olive green
  '#ffc000', // amber
  '#ff7f50', // coral
  '#9dc3e6', // powder blue
  '#6fdc8c', // mint
  '#c55a11', // rust
  '#b185db', // lavender
  '#00b0f0', // sky blue
  '#ff9f99', // salmon
  '#82ca9d', // seafoam
  '#f4a460', // sandy brown
];

/** PixiJS hex integer equivalents (same order as REGION_CSS_COLORS) — used by GameMap. */
export const REGION_PIXI_COLORS: readonly number[] = [
  0x5b9bd5,
  0x70ad47,
  0xffc000,
  0xff7f50,
  0x9dc3e6,
  0x6fdc8c,
  0xc55a11,
  0xb185db,
  0x00b0f0,
  0xff9f99,
  0x82ca9d,
  0xf4a460,
];

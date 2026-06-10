import { REGION_CSS_COLORS, REGION_PIXI_COLORS } from './regionColors';
import { isColorblindMode } from '../utils/userPreferences';

/** Colorblind-safe player palette — distinct hues with higher luminance separation. */
export const ACCESSIBLE_PLAYER_HEX: readonly string[] = [
  '#e69f00', // orange
  '#56b4e9', // sky blue
  '#009e73', // bluish green
  '#f0e442', // yellow
  '#0072b2', // blue
  '#d55e00', // vermillion
  '#cc79a7', // reddish purple
  '#999999', // gray (replaces low-contrast white)
];

export const ACCESSIBLE_PLAYER_CSS: Record<string, string> = {
  '#e69f00': 'rgba(230, 159, 0, 0.96)',
  '#56b4e9': 'rgba(86, 180, 233, 0.96)',
  '#009e73': 'rgba(0, 158, 115, 0.96)',
  '#f0e442': 'rgba(240, 228, 66, 0.96)',
  '#0072b2': 'rgba(0, 114, 178, 0.96)',
  '#d55e00': 'rgba(213, 94, 0, 0.96)',
  '#cc79a7': 'rgba(204, 121, 167, 0.96)',
  '#999999': 'rgba(153, 153, 153, 0.96)',
};

export const ACCESSIBLE_PLAYER_CSS_SOLID: Record<string, string> = {
  '#e69f00': 'rgb(230, 159, 0)',
  '#56b4e9': 'rgb(86, 180, 233)',
  '#009e73': 'rgb(0, 158, 115)',
  '#f0e442': 'rgb(240, 228, 66)',
  '#0072b2': 'rgb(0, 114, 178)',
  '#d55e00': 'rgb(213, 94, 0)',
  '#cc79a7': 'rgb(204, 121, 167)',
  '#999999': 'rgb(153, 153, 153)',
};

export const ACCESSIBLE_PLAYER_PIXI: Record<string, number> = {
  '#e69f00': 0xe69f00,
  '#56b4e9': 0x56b4e9,
  '#009e73': 0x009e73,
  '#f0e442': 0xf0e442,
  '#0072b2': 0x0072b2,
  '#d55e00': 0xd55e00,
  '#cc79a7': 0xcc79a7,
  '#999999': 0x999999,
};

/** Colorblind-safe region palette — Wong palette inspired, distinct from players. */
export const ACCESSIBLE_REGION_CSS_COLORS: readonly string[] = [
  '#88ccee',
  '#44aa99',
  '#117733',
  '#ddcc77',
  '#cc6677',
  '#aa4499',
  '#332288',
  '#882255',
  '#6699cc',
  '#997700',
  '#44bb88',
  '#bb5566',
];

export const ACCESSIBLE_REGION_PIXI_COLORS: readonly number[] = [
  0x88ccee,
  0x44aa99,
  0x117733,
  0xddcc77,
  0xcc6677,
  0xaa4499,
  0x332288,
  0x882255,
  0x6699cc,
  0x997700,
  0x44bb88,
  0xbb5566,
];

const DEFAULT_PLAYER_PIXI: Record<string, number> = {
  '#e74c3c': 0xe74c3c,
  '#3498db': 0x3498db,
  '#2ecc71': 0x2ecc71,
  '#f39c12': 0xf39c12,
  '#9b59b6': 0x9b59b6,
  '#1abc9c': 0x1abc9c,
  '#e67e22': 0xe67e22,
  '#ecf0f1': 0xecf0f1,
};

const DEFAULT_PLAYER_CSS: Record<string, string> = {
  '#e74c3c': 'rgba(231, 76, 60, 0.96)',
  '#3498db': 'rgba(52, 152, 219, 0.96)',
  '#2ecc71': 'rgba(46, 204, 113, 0.96)',
  '#f39c12': 'rgba(243, 156, 18, 0.96)',
  '#9b59b6': 'rgba(155, 89, 182, 0.96)',
  '#1abc9c': 'rgba(26, 188, 156, 0.96)',
  '#e67e22': 'rgba(230, 126, 34, 0.96)',
  '#ecf0f1': 'rgba(236, 240, 241, 0.96)',
};

const DEFAULT_PLAYER_CSS_SOLID: Record<string, string> = {
  '#e74c3c': 'rgb(231, 76, 60)',
  '#3498db': 'rgb(52, 152, 219)',
  '#2ecc71': 'rgb(46, 204, 113)',
  '#f39c12': 'rgb(243, 156, 18)',
  '#9b59b6': 'rgb(155, 89, 182)',
  '#1abc9c': 'rgb(26, 188, 156)',
  '#e67e22': 'rgb(230, 126, 34)',
  '#ecf0f1': 'rgb(236, 240, 241)',
};

const STANDARD_PLAYER_ORDER = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#ecf0f1',
] as const;

function normalizePlayerHex(hex: string | null | undefined): string {
  // Missing colors (malformed fixtures, partial states) fall back to neutral
  // grey rather than crashing the whole map render.
  if (!hex) return '#888888';
  const trimmed = hex.trim();
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : trimmed;
}

function mapPlayerHex(hex: string): string {
  const normalized = normalizePlayerHex(hex);
  if (!isColorblindMode()) return normalized;
  const idx = STANDARD_PLAYER_ORDER.indexOf(normalized as (typeof STANDARD_PLAYER_ORDER)[number]);
  if (idx >= 0) return ACCESSIBLE_PLAYER_HEX[idx] ?? normalized;
  return normalized;
}

export function getRegionCssColors(): readonly string[] {
  return isColorblindMode() ? ACCESSIBLE_REGION_CSS_COLORS : REGION_CSS_COLORS;
}

export function getRegionPixiColors(): readonly number[] {
  return isColorblindMode() ? ACCESSIBLE_REGION_PIXI_COLORS : REGION_PIXI_COLORS;
}

export function getPlayerGlobeColor(hex: string, solid = false): string {
  const mapped = mapPlayerHex(hex);
  if (!isColorblindMode()) {
    return solid ? (DEFAULT_PLAYER_CSS_SOLID[mapped] ?? mapped) : (DEFAULT_PLAYER_CSS[mapped] ?? mapped);
  }
  return solid
    ? (ACCESSIBLE_PLAYER_CSS_SOLID[mapped] ?? mapped)
    : (ACCESSIBLE_PLAYER_CSS[mapped] ?? mapped);
}

export function getPlayerPixiColor(hex: string): number {
  const mapped = mapPlayerHex(hex);
  if (!isColorblindMode()) {
    return DEFAULT_PLAYER_PIXI[mapped] ?? 0x888888;
  }
  return ACCESSIBLE_PLAYER_PIXI[mapped] ?? 0x888888;
}

export function getPlayerHexColor(hex: string): string {
  return mapPlayerHex(hex);
}

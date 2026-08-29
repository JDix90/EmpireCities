/**
 * Shared in-game highlight palette used by GameMap (PixiJS) and GlobeMap.
 *
 * These say something about *your* interaction — what's selected, what you can
 * hit, where you can act from — so they must never be mistakable for a player's
 * faction color. Each entry is deliberately clear of both player palettes in
 * `accessibleColors.ts` (default and colorblind) rather than swapping per mode:
 * one set that works everywhere beats two sets that each work half the time.
 * `highlightColors.test.ts` enforces the separation.
 *
 * The valid-source hint in particular used to be emerald `#34d399` on the 2D map
 * and a different emerald (`#34e7a0`) on the globe — both sitting between the
 * default palette's green `#2ecc71` and teal `#1abc9c`, so a hint could read as
 * a third army. It is now a pale cyan that separates by *value*: much lighter
 * than any faction fill, so it reads as UI chrome at a glance.
 */

export type HighlightKey =
  | 'selected'
  | 'attackTarget'
  | 'fortifyTarget'
  | 'validSource'
  | 'contested'
  | 'wonder'
  | 'coach';

/** One source of truth per semantic role; PIXI ints and CSS strings derive from these. */
export const HIGHLIGHT_HEX: Record<HighlightKey, string> = {
  /** Your current selection / the locked-in attacker. */
  selected: '#ffd700',
  /** A territory you may attack from the armed source. */
  attackTarget: '#f87171',
  /**
   * A territory you may fortify into. Lighter than the old `#4ade80`, which sat
   * ~36 from the default palette's green `#2ecc71` — close enough that a green
   * player's own borders and the fortify hint blurred together.
   */
  fortifyTarget: '#86efac',
  /** "You can act from here" hint, shown only before a source is picked. */
  validSource: '#a5f3fc',
  /** Contested / disputed border treatment. */
  contested: '#ffffff',
  /** Wonder ring. */
  wonder: '#ffd700',
  /** Tutorial and first-turn-coach pulse. */
  coach: '#ffd700',
};

function toPixi(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** PixiJS hex integers — used by GameMap. */
export const HIGHLIGHT_PIXI: Record<HighlightKey, number> = Object.fromEntries(
  (Object.keys(HIGHLIGHT_HEX) as HighlightKey[]).map((k) => [k, toPixi(HIGHLIGHT_HEX[k])]),
) as Record<HighlightKey, number>;

/** CSS hex strings — used by GlobeMap polygon strokes and HTML chrome. */
export const HIGHLIGHT_CSS: Record<HighlightKey, string> = HIGHLIGHT_HEX;

/** `rgba()` form for the globe's pulse rings, which animate their alpha. */
export function highlightRgba(key: HighlightKey, alpha: number): string {
  const value = HIGHLIGHT_PIXI[key];
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

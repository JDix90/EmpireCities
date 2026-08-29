import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_HEX, HIGHLIGHT_PIXI, HIGHLIGHT_CSS, highlightRgba, type HighlightKey } from './highlightColors';
import { ACCESSIBLE_PLAYER_HEX, STANDARD_PLAYER_ORDER } from './accessibleColors';

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * The interaction hints that sit *on* the board must not read as a faction.
 * `selected`/`wonder`/`coach` are gold and `contested` is white — both are
 * long-standing chrome the palettes already work around — so this guards the
 * three that changed, and `validSource` above all: its old emerald sat between
 * the default palette's green and teal.
 */
const MUST_CLEAR_PLAYER_COLORS: HighlightKey[] = ['validSource', 'attackTarget', 'fortifyTarget'];
const MIN_DISTANCE = 60;

describe('highlight colors', () => {
  it('keeps board hints clear of every player color in both palettes', () => {
    const playerColors = [...STANDARD_PLAYER_ORDER, ...ACCESSIBLE_PLAYER_HEX];
    for (const key of MUST_CLEAR_PLAYER_COLORS) {
      for (const player of playerColors) {
        const d = distance(HIGHLIGHT_HEX[key], player);
        expect(
          d,
          `highlight "${key}" (${HIGHLIGHT_HEX[key]}) is too close to player color ${player} (distance ${d.toFixed(1)})`,
        ).toBeGreaterThan(MIN_DISTANCE);
      }
    }
  });

  it('specifically separates the valid-source hint from the greens it used to sit between', () => {
    // #2ecc71 (default green) and #1abc9c (default teal) flanked the old #34d399.
    expect(distance(HIGHLIGHT_HEX.validSource, '#2ecc71')).toBeGreaterThan(100);
    expect(distance(HIGHLIGHT_HEX.validSource, '#1abc9c')).toBeGreaterThan(100);
    expect(distance(HIGHLIGHT_HEX.validSource, '#009e73')).toBeGreaterThan(100);
  });

  it('derives PIXI and CSS forms from the same source hex', () => {
    for (const key of Object.keys(HIGHLIGHT_HEX) as HighlightKey[]) {
      expect(HIGHLIGHT_CSS[key]).toBe(HIGHLIGHT_HEX[key]);
      expect(HIGHLIGHT_PIXI[key]).toBe(parseInt(HIGHLIGHT_HEX[key].slice(1), 16));
    }
  });

  it('builds rgba strings for the globe pulse rings', () => {
    expect(highlightRgba('validSource', 0.5)).toBe('rgba(165, 243, 252, 0.5)');
    expect(highlightRgba('coach', 1)).toBe('rgba(255, 215, 0, 1)');
  });
});

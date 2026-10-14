import { describe, it, expect } from 'vitest';
import {
  clampPan,
  clampScale,
  isDoubleTap,
  MAX_MAP_SCALE,
  MIN_MAP_SCALE,
  panMargin,
  pinchView,
  zoomAbout,
} from './mapGestures';

/** Where content point p lands on screen for a view (pos, scale). */
const onScreen = (pos: { x: number; y: number }, scale: number, p: { x: number; y: number }) => ({
  x: pos.x + p.x * scale,
  y: pos.y + p.y * scale,
});

describe('mapGestures', () => {
  it('zoomAbout keeps the focus point still', () => {
    const pos = { x: -40, y: 10 };
    const focus = { x: 200, y: 300 };
    const next = zoomAbout(pos, 1.5, 3, focus);
    // The content point under the focus before and after is the same.
    const before = { x: (focus.x - pos.x) / 1.5, y: (focus.y - pos.y) / 1.5 };
    expect(onScreen(next, 3, before).x).toBeCloseTo(focus.x);
    expect(onScreen(next, 3, before).y).toBeCloseTo(focus.y);
  });

  it('pinchView zooms around the midpoint between the fingers', () => {
    const start = { mid: { x: 195, y: 330 }, dist: 100, pos: { x: 0, y: 0 }, scale: 1 };
    const { pos, scale } = pinchView(start, start.mid, 200);
    expect(scale).toBe(2);
    // The land that was between the fingers is still between them.
    expect(onScreen(pos, scale, { x: 195, y: 330 })).toEqual({ x: 195, y: 330 });
    // The old behaviour, scaling around the corner, would have moved it to 390,660.
    expect(onScreen({ x: 0, y: 0 }, 2, { x: 195, y: 330 })).toEqual({ x: 390, y: 660 });
  });

  it('pinchView follows the fingers when they move together', () => {
    const start = { mid: { x: 100, y: 100 }, dist: 80, pos: { x: 0, y: 0 }, scale: 1 };
    const { pos, scale } = pinchView(start, { x: 160, y: 120 }, 80);
    expect(scale).toBe(1);
    expect(pos).toEqual({ x: 60, y: 20 });
  });

  it('pinchView clamps the scale and survives a zero start distance', () => {
    const start = { mid: { x: 0, y: 0 }, dist: 10, pos: { x: 0, y: 0 }, scale: 1 };
    expect(pinchView(start, start.mid, 1000).scale).toBe(MAX_MAP_SCALE);
    expect(pinchView(start, start.mid, 0.1).scale).toBe(MIN_MAP_SCALE);
    expect(pinchView({ ...start, dist: 0 }, start.mid, 50).scale).toBe(1);
    expect(clampScale(2)).toBe(2);
  });

  it('clampPan keeps a strip of land on screen whichever way the map is flung', () => {
    const view = { w: 390, h: 500 };
    // The land sits in the middle of the canvas, as Britain does on its map.
    const land = { x0: 100, y0: 150, x1: 300, y1: 450 };
    const margin = panMargin(view);
    expect(margin).toBe(96);
    // Flung far right and down: the land's left/top edge stops margin px in.
    const right = clampPan({ x: 5000, y: 5000 }, 1, view, land, margin);
    expect(right).toEqual({ x: 390 - 96 - 100, y: 500 - 96 - 150 });
    expect(right.x + land.x0).toBe(390 - 96);
    // Flung far left and up at 2x: its right/bottom edge stops margin px in.
    const left = clampPan({ x: -5000, y: -5000 }, 2, view, land, margin);
    expect(left).toEqual({ x: 96 - 600, y: 96 - 900 });
    expect(left.x + land.x1 * 2).toBe(96);
    // A position inside the bounds is left alone.
    expect(clampPan({ x: -100, y: -50 }, 2, view, land, margin)).toEqual({ x: -100, y: -50 });
  });

  it('clampPan keeps a fully zoomed-out map whole on screen when it is smaller than the margin', () => {
    const view = { w: 390, h: 500 };
    const tiny = { x0: 0, y0: 0, x1: 100, y1: 100 };
    // 100px of land at 0.3 is 30px wide: it stays entirely on screen.
    const pos = clampPan({ x: -1000, y: 2000 }, 0.3, view, tiny, 96);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(500 - 30);
  });

  it('isDoubleTap needs two quick taps close together', () => {
    const first = { at: 1000, point: { x: 100, y: 100 } };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1200, point: { x: 110, y: 95 } })).toBe(true);
    expect(isDoubleTap(first, { at: 1400, point: { x: 100, y: 100 } })).toBe(false);
    expect(isDoubleTap(first, { at: 1100, point: { x: 200, y: 100 } })).toBe(false);
  });
});

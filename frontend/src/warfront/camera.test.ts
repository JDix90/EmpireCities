import { describe, it, expect } from 'vitest';
import {
  MAX_SCALE,
  centerOn,
  clampCamera,
  fitCamera,
  fitScale,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
} from './camera';

const VIEWPORT = { width: 200, height: 200 };
const BIG = { width: 1000, height: 1000 };
const WIDE = { width: 100, height: 50 };

describe('fit', () => {
  it('fits the limiting axis and centres the camera', () => {
    expect(fitScale(WIDE, VIEWPORT)).toBe(2); // width binds: 200/100
    const cam = fitCamera(WIDE, VIEWPORT);
    expect(cam.scale).toBe(2);
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(25);
  });

  it('survives a degenerate viewport instead of returning Infinity or NaN', () => {
    expect(fitScale(WIDE, { width: 0, height: 0 })).toBe(1);
    expect(Number.isFinite(fitCamera({ width: 0, height: 0 }, VIEWPORT).scale)).toBe(true);
  });
});

describe('clamp', () => {
  it('never zooms out past the fit scale, nor in past MAX_SCALE', () => {
    expect(clampCamera({ x: 500, y: 500, scale: 0.0001 }, BIG, VIEWPORT).scale).toBe(fitScale(BIG, VIEWPORT));
    expect(clampCamera({ x: 500, y: 500, scale: 9999 }, BIG, VIEWPORT).scale).toBe(MAX_SCALE);
  });

  it('keeps the viewport inside the grid when the grid is larger', () => {
    const cam = clampCamera({ x: -9999, y: 9999, scale: 1 }, BIG, VIEWPORT);
    expect(cam.x).toBe(100); // half a 200px viewport at 1 px/cell
    expect(cam.y).toBe(900);
  });

  it('centres on an axis where the grid is smaller than the viewport', () => {
    // At the fit scale the short axis is letterboxed; without centring the map would
    // jam against an edge on any viewport whose aspect differs from the grid's.
    const cam = clampCamera({ x: 0, y: 0, scale: fitScale(WIDE, VIEWPORT) }, WIDE, VIEWPORT);
    expect(cam.y).toBe(25);
  });
});

describe('screen/world round trip', () => {
  it('inverts exactly', () => {
    const cam = { x: 400, y: 300, scale: 1.5 };
    const w = screenToWorld(cam, VIEWPORT, 37, 129);
    const s = worldToScreen(cam, VIEWPORT, w.x, w.y);
    expect(s.x).toBeCloseTo(37, 10);
    expect(s.y).toBeCloseTo(129, 10);
  });
});

describe('pan', () => {
  it('moves the world opposite the drag, in cells', () => {
    const cam = panCamera({ x: 500, y: 500, scale: 2 }, BIG, VIEWPORT, 20, -10);
    expect(cam.x).toBe(490);
    expect(cam.y).toBe(505);
  });
});

describe('zoom', () => {
  it('pins the world point under the cursor', () => {
    const cam = fitCamera(BIG, VIEWPORT);
    const anchorBefore = screenToWorld(cam, VIEWPORT, 50, 50);
    const zoomed = zoomCameraAt(cam, BIG, VIEWPORT, 50, 50, 3);
    const screenAfter = worldToScreen(zoomed, VIEWPORT, anchorBefore.x, anchorBefore.y);
    expect(screenAfter.x).toBeCloseTo(50, 6);
    expect(screenAfter.y).toBeCloseTo(50, 6);
    expect(zoomed.scale).toBeCloseTo(cam.scale * 3, 10);
  });

  it('still clamps when the zoom would leave the grid', () => {
    const zoomed = zoomCameraAt({ x: 500, y: 500, scale: 4 }, BIG, VIEWPORT, 0, 0, 1 / 100);
    expect(zoomed.scale).toBe(fitScale(BIG, VIEWPORT));
    expect(zoomed.x).toBe(500);
  });
});

describe('centerOn', () => {
  it('moves the centre without changing zoom', () => {
    const cam = centerOn({ x: 100, y: 100, scale: 3 }, BIG, VIEWPORT, 400, 650);
    expect(cam.scale).toBe(3);
    expect(cam.x).toBe(400);
    expect(cam.y).toBe(650);
  });
});

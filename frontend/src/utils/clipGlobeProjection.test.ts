import { describe, it, expect } from 'vitest';
import {
  angularExtentOf,
  globeRadiusPx,
  projectRing,
  toCameraFrame,
  type ClipGlobeCamera,
  type ClipGlobeViewport,
} from './clipGlobeProjection';

const VIEW: ClipGlobeViewport = { cx: 100, cy: 100, radius: 50 };
const cam = (centerLng: number, centerLat: number, angularRadiusDeg = 90): ClipGlobeCamera => ({
  centerLng,
  centerLat,
  angularRadiusDeg,
});

/** Closed lon/lat square centered on a point — stands in for a territory. */
function square(lng: number, lat: number, half: number): [number, number][] {
  return [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
  ];
}

describe('toCameraFrame', () => {
  it('puts the camera center at the front of the sphere', () => {
    const p = toCameraFrame(30, 45, cam(30, 45));
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(1, 10);
  });

  it('puts the antipode at the back', () => {
    expect(toCameraFrame(-150, -45, cam(30, 45)).z).toBeCloseTo(-1, 10);
  });

  it('places a quarter-turn east exactly on the limb, to the right', () => {
    const p = toCameraFrame(90, 0, cam(0, 0));
    expect(p.x).toBeCloseTo(1, 10);
    expect(p.z).toBeCloseTo(0, 10);
  });

  it('places north of the equator above the center', () => {
    expect(toCameraFrame(0, 20, cam(0, 0)).y).toBeGreaterThan(0);
  });
});

describe('globeRadiusPx', () => {
  it('fits the whole hemisphere exactly at 90 degrees', () => {
    expect(globeRadiusPx(cam(0, 0, 90), 200)).toBeCloseTo(200, 6);
  });

  it('grows the sphere as the camera covers less of it', () => {
    // A 30° cap reaches sin(30°) = half the disc, so the sphere must be twice
    // the pixel radius being filled.
    expect(globeRadiusPx(cam(0, 0, 30), 200)).toBeCloseTo(400, 6);
    expect(globeRadiusPx(cam(0, 0, 10), 200)).toBeGreaterThan(globeRadiusPx(cam(0, 0, 30), 200));
  });
});

describe('projectRing', () => {
  const within = (pts: [number, number][]) =>
    pts.every(([x, y]) => Math.hypot(x - VIEW.cx, y - VIEW.cy) <= VIEW.radius + 1e-6);

  it('rejects degenerate rings', () => {
    expect(projectRing([[0, 0], [1, 1]], cam(0, 0), VIEW)).toBeNull();
  });

  it('drops a ring that is entirely around the back', () => {
    expect(projectRing(square(180, 0, 5), cam(0, 0), VIEW)).toBeNull();
  });

  it('keeps every vertex of a ring facing the camera', () => {
    const pts = projectRing(square(0, 0, 5), cam(0, 0), VIEW);
    expect(pts).not.toBeNull();
    expect(pts!.length).toBe(4);
    expect(within(pts!)).toBe(true);
  });

  it('projects north above the center and east to the right', () => {
    const pts = projectRing(square(10, 10, 2), cam(0, 0), VIEW)!;
    const [x, y] = pts[0];
    expect(x).toBeGreaterThan(VIEW.cx);
    // Canvas y grows downward, so north of center means a smaller y.
    expect(y).toBeLessThan(VIEW.cy);
  });

  it('walks a straddling ring along the limb instead of chording across it', () => {
    // Centered on the horizon: half this ring is around the back.
    const pts = projectRing(square(90, 0, 12), cam(0, 0), VIEW);
    expect(pts).not.toBeNull();
    expect(within(pts!)).toBe(true);
    const onLimb = pts!.filter(
      ([x, y]) => Math.abs(Math.hypot(x - VIEW.cx, y - VIEW.cy) - VIEW.radius) < 1e-6,
    );
    // A straight chord would contribute at most the two crossing points; the
    // arc walk adds intermediate ones, which is what keeps a territory on the
    // edge of the world from having a bite taken out of it.
    expect(onLimb.length).toBeGreaterThan(2);
  });

  it('never leaves the disc, whichever way the camera faces', () => {
    for (const centerLng of [-180, -90, 0, 90, 179]) {
      for (const centerLat of [-80, -30, 0, 30, 80]) {
        for (const lng of [-170, -60, 0, 60, 170]) {
          const pts = projectRing(square(lng, 20, 15), cam(centerLng, centerLat), VIEW);
          if (pts) expect(within(pts)).toBe(true);
        }
      }
    }
  });
});

describe('angularExtentOf', () => {
  it('returns null with nothing to frame', () => {
    expect(angularExtentOf([])).toBeNull();
  });

  it('centers on the mean direction and measures the furthest point', () => {
    const extent = angularExtentOf([[-10, 0], [10, 0], [0, 0]])!;
    expect(extent.centerLng).toBeCloseTo(0, 4);
    expect(extent.centerLat).toBeCloseTo(0, 4);
    expect(extent.radiusDeg).toBeCloseTo(10, 4);
  });

  it('stays on the right side of the planet across the date line', () => {
    // Averaging degrees would land on longitude 0 — the far side of the globe
    // from a Pacific theater, with the whole map behind the camera.
    const extent = angularExtentOf([[175, 0], [-175, 0]])!;
    expect(Math.abs(extent.centerLng)).toBeGreaterThan(179);
    expect(extent.radiusDeg).toBeCloseTo(5, 4);
  });

  it('covers everything when the points wrap the whole globe', () => {
    const extent = angularExtentOf([[0, 0], [90, 0], [180, 0], [-90, 0], [0, 90], [0, -90]])!;
    expect(extent.radiusDeg).toBe(90);
  });

  it('keeps an authored center and measures the reach from there', () => {
    const extent = angularExtentOf([[0, 0], [10, 0]], { lng: 0, lat: 0 })!;
    expect(extent.centerLng).toBe(0);
    expect(extent.centerLat).toBe(0);
    expect(extent.radiusDeg).toBeCloseTo(10, 4);
  });
});

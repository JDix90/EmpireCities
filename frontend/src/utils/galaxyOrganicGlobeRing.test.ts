import { describe, it, expect } from 'vitest';
import {
  buildOrganicGalaxyCapRing,
  signedLngLatRingArea,
} from './galaxyOrganicGlobeRing';

describe('buildOrganicGalaxyCapRing', () => {
  // NW → NE → SE → SW (canvas-projected rectangle order)
  const rect: [number, number][] = [
    [-162, -2.43],
    [-120, -2.43],
    [-120, -21.86],
    [-162, -21.86],
  ];

  it('keeps math-CW winding for d3-geo / conic caps', () => {
    const ring = buildOrganicGalaxyCapRing(rect, 'rust_olympus', 'rust');
    expect(ring.length).toBeGreaterThan(16);
    expect(signedLngLatRingArea(ring)).toBeGreaterThan(0);
  });

  it('profile differs by world (deterministic)', () => {
    const rustRing = buildOrganicGalaxyCapRing(rect, 'rust_olympus', 'rust');
    const verdanRing = buildOrganicGalaxyCapRing(rect, 'verdan_aurora', 'verdan');
    expect(rustRing.length).not.toBe(verdanRing.length);
    expect(signedLngLatRingArea(verdanRing)).toBeGreaterThan(0);
  });

  it('passes through non-quads unchanged', () => {
    const tri: [number, number][] = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ];
    expect(buildOrganicGalaxyCapRing(tri, 'x', 'sol')).toEqual(tri);
  });
});

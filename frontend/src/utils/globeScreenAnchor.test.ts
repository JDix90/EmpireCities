import { describe, it, expect } from 'vitest';
import { centralAngle, globeScreenAnchor, horizonAngle, type GeoPointOfView } from './globeScreenAnchor';

const DEG = 180 / Math.PI;

/**
 * Anchor a point with a projection that draws each point at (lng, lat) and
 * records the altitude it was asked for.
 */
function anchor(lat: number, lng: number, pov: GeoPointOfView, altitude?: number) {
  const asked: number[] = [];
  const at = globeScreenAnchor(lat, lng, pov, (pLat, pLng, pAlt) => {
    asked.push(pAlt);
    return { x: pLng, y: pLat };
  }, altitude);
  return { ...at, asked };
}

describe('horizonAngle', () => {
  it('sees further round the sphere from higher up', () => {
    // One radius above the surface, the horizon is 60° away.
    expect(horizonAngle(1) * DEG).toBeCloseTo(60, 6);
    expect(horizonAngle(2.3)).toBeGreaterThan(horizonAngle(1));
    expect(horizonAngle(0)).toBe(0);
  });
});

describe('globeScreenAnchor', () => {
  const pov = { lat: 0, lng: 0, altitude: 1 }; // horizon 60° away

  it('puts a point the camera sees where the globe draws it, raised as asked', () => {
    expect(anchor(10, 40, pov, 0.03)).toEqual({ x: 40, y: 10, asked: [0.03] });
    expect(anchor(0, 59.9, pov)).toEqual({ x: 59.9, y: 0, asked: [0] });
  });

  it('keeps a raised point in sight a little past the surface horizon', () => {
    // 0.03 radii up stays in sight about 13.9° past the 60° horizon.
    expect(anchor(0, 73, pov, 0.03).behind).toBeUndefined();
    expect(anchor(0, 75, pov, 0.03).behind).toBe(true);
    expect(anchor(0, 61, pov).behind).toBe(true);
  });

  it("puts a point around the back on the planet's edge, on the way to it", () => {
    const at = anchor(30, 120, pov, 0.03);
    expect(at.behind).toBe(true);
    // On the edge: the horizon's distance from the point under the camera, on the surface.
    expect(centralAngle(0, 0, at.y, at.x)).toBeCloseTo(horizonAngle(1), 9);
    expect(at.asked).toEqual([0]);
    // On the great circle toward the point: the two legs add up to the whole way.
    expect(centralAngle(0, 0, at.y, at.x) + centralAngle(at.y, at.x, 30, 120)).toBeCloseTo(centralAngle(0, 0, 30, 120), 9);
  });

  it('reads the camera from anywhere, across the date line', () => {
    const overPacific = { lat: -20, lng: 170, altitude: 1 };
    const at = anchor(-20, -10, overPacific);
    expect(at.behind).toBe(true);
    expect(at.x).toBeGreaterThanOrEqual(-180);
    expect(at.x).toBeLessThan(180);
    expect(centralAngle(-20, 170, at.y, at.x)).toBeCloseTo(horizonAngle(1), 9);
    // Just across the date line from the camera: in sight.
    expect(anchor(-20, -175, overPacific)).toEqual({ x: -175, y: -20, asked: [0] });
  });

  it('still finds an edge for the point straight through the planet', () => {
    const at = anchor(0, 180, pov);
    expect(at.behind).toBe(true);
    expect(centralAngle(0, 0, at.y, at.x)).toBeCloseTo(horizonAngle(1), 9);
  });
});

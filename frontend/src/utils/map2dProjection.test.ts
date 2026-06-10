import { describe, it, expect } from 'vitest';
import { buildGeoLayout2d, projectPoint, unionBounds } from './map2dProjection';
import type { PolygonData } from './globeTerritoryGeometry';

function poly(id: string, ring: [number, number][]): PolygonData {
  return {
    territory_id: id,
    name: id,
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

const SQUARE: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('projectPoint', () => {
  const bounds = { minLng: -20, maxLng: 20, minLat: -10, maxLat: 10 };

  it('maps the bounds corners to the fitted canvas extent, north up', () => {
    // 40°×20° box into 800×400 canvas → scale 20 px/°, no letterbox.
    expect(projectPoint(-20, 10, bounds, 800, 400)).toEqual([0, 0]); // NW corner → top-left
    expect(projectPoint(20, -10, bounds, 800, 400)).toEqual([800, 400]); // SE → bottom-right
    expect(projectPoint(0, 0, bounds, 800, 400)).toEqual([400, 200]); // center
  });

  it('letterboxes when aspect ratios differ', () => {
    // Same box into a square canvas → vertical centering offset of 100.
    expect(projectPoint(-20, 10, bounds, 400, 400)).toEqual([0, 100]);
    expect(projectPoint(20, -10, bounds, 400, 400)).toEqual([400, 300]);
  });
});

describe('unionBounds', () => {
  it('spans all geometries', () => {
    const b = unionBounds([
      poly('a', SQUARE),
      poly('b', [[30, -5], [40, -5], [40, 5], [30, 5], [30, -5]]),
    ]);
    expect(b).toEqual({ minLng: 0, maxLng: 40, minLat: -5, maxLat: 10 });
  });

  it('returns null for empty/degenerate input', () => {
    expect(unionBounds([])).toBeNull();
  });
});

describe('buildGeoLayout2d', () => {
  it('projects rings and centroids for full coverage', () => {
    const layout = buildGeoLayout2d([poly('a', SQUARE)], ['a'], 100, 100);
    expect(layout).not.toBeNull();
    const rings = layout!.rings.get('a')!;
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
    const [cx, cy] = layout!.centers.get('a')!;
    expect(cx).toBeGreaterThan(0);
    expect(cy).toBeGreaterThan(0);
  });

  it('is all-or-nothing: returns null when any territory lacks geometry', () => {
    expect(buildGeoLayout2d([poly('a', SQUARE)], ['a', 'missing'], 100, 100)).toBeNull();
  });

  it('uses explicit map bounds when provided', () => {
    const layout = buildGeoLayout2d([poly('a', SQUARE)], ['a'], 100, 100, {
      minLng: 0, maxLng: 20, minLat: 0, maxLat: 20,
    });
    // Square spans only the left half of the bounds → centroid in left half.
    const [cx] = layout!.centers.get('a')!;
    expect(cx).toBeLessThan(50);
  });
});

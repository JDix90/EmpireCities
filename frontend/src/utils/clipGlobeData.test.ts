import { describe, it, expect } from 'vitest';
import { buildClipGlobeData } from './clipGlobeData';
import type { PolygonData } from './globeTerritoryGeometry';

function box(id: string, lng: number, lat: number, half = 2): PolygonData {
  return {
    territory_id: id,
    name: id,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
      ]],
    },
  };
}

/** A ring with `n` vertices around a point — stands in for a real coastline. */
function dense(id: string, n: number): PolygonData {
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([Math.cos(a) * 3, Math.sin(a) * 3]);
  }
  ring.push(ring[0]);
  return { territory_id: id, name: id, geometry: { type: 'Polygon', coordinates: [ring] } };
}

describe('buildClipGlobeData', () => {
  it('returns null with no geometry or no territories to draw', () => {
    expect(buildClipGlobeData([], { territoryIds: ['a'] })).toBeNull();
    expect(buildClipGlobeData([box('a', 0, 0)], { territoryIds: [] })).toBeNull();
  });

  it('returns null when barely any territory resolved', () => {
    // One shape out of ten is not a globe worth showing — the flat authored
    // board is the better fallback.
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(buildClipGlobeData([box('t0', 0, 0)], { territoryIds: ids })).toBeNull();
  });

  it('keeps the territories it resolved and skips the ones it did not', () => {
    const data = buildClipGlobeData([box('a', 0, 0), box('b', 4, 0)], {
      territoryIds: ['a', 'b', 'missing'],
    })!;
    expect(data.territories.map((t) => t.territory_id)).toEqual(['a', 'b']);
  });

  it('carries multipolygon islands as separate rings', () => {
    const multi: PolygonData = {
      territory_id: 'isles',
      name: 'isles',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[8, 8], [9, 8], [9, 9], [8, 9], [8, 8]]],
        ],
      },
    };
    const data = buildClipGlobeData([multi], { territoryIds: ['isles'] })!;
    expect(data.territories[0].rings).toHaveLength(2);
  });

  it('decimates coastlines to the per-frame budget', () => {
    // Natural Earth rings run to tens of thousands of vertices, and every one
    // costs trigonometry the output resolution cannot show.
    const data = buildClipGlobeData([dense('a', 9000), box('b', 4, 0)], {
      territoryIds: ['a', 'b'],
    })!;
    const ring = data.territories[0].rings[0];
    expect(ring.length).toBeLessThanOrEqual(400);
    expect(ring.length).toBeGreaterThan(100);
  });

  it('leaves a ring alone when it is already inside the budget', () => {
    const data = buildClipGlobeData([box('a', 0, 0), box('b', 4, 0)], { territoryIds: ['a', 'b'] })!;
    expect(data.territories[0].rings[0]).toHaveLength(5);
  });

  it('frames the camera on the geometry it is given', () => {
    const data = buildClipGlobeData([box('a', 20, 40), box('b', 24, 44)], {
      territoryIds: ['a', 'b'],
    })!;
    expect(data.camera.centerLng).toBeGreaterThan(18);
    expect(data.camera.centerLng).toBeLessThan(26);
    expect(data.camera.centerLat).toBeGreaterThan(38);
    expect(data.camera.centerLat).toBeLessThan(46);
  });

  it('honors a map-authored camera center over the computed one', () => {
    const data = buildClipGlobeData([box('a', 20, 40), box('b', 24, 44)], {
      territoryIds: ['a', 'b'],
      globeView: { center_lat: 0, center_lng: 0 },
    })!;
    expect(data.camera.centerLng).toBe(0);
    expect(data.camera.centerLat).toBe(0);
    // The reach is measured from the authored center, so the whole theater
    // still fits rather than falling off the edge of the frame.
    expect(data.camera.angularRadiusDeg).toBeGreaterThan(45);
  });

  it('opens out to the full hemisphere for a world-spanning board', () => {
    const world = [
      box('a', 0, 0), box('b', 90, 0), box('c', 180, 0), box('d', -90, 0),
      box('e', 0, 70), box('f', 0, -70),
    ];
    const data = buildClipGlobeData(world, { territoryIds: world.map((t) => t.territory_id) })!;
    expect(data.camera.angularRadiusDeg).toBe(90);
  });

  it('never zooms past the floor, however small the theater', () => {
    const data = buildClipGlobeData([box('a', 10, 10, 0.02), box('b', 10.05, 10, 0.02)], {
      territoryIds: ['a', 'b'],
    })!;
    expect(data.camera.angularRadiusDeg).toBe(6);
  });

  it('leaves margin so coastlines do not touch the frame edge', () => {
    // Two boxes 8° apart span ~5° from center; the camera must cover more.
    const data = buildClipGlobeData([box('a', 0, 0), box('b', 8, 0)], { territoryIds: ['a', 'b'] })!;
    expect(data.camera.angularRadiusDeg).toBeGreaterThan(6);
  });
});

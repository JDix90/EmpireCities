import { describe, it, expect } from 'vitest';
import {
  bridgeComponents,
  cameraBbox,
  classifyNeighbor,
  findNeighbors,
  geometryLabelPoint,
  largestExteriorRing,
  regionStats,
  ringAreaKm2,
  ringOverlaps,
  ringSelfIntersects,
  suggestRegionBonus,
  trimRing,
  wrapLng,
  type PolyGeom,
  type Ring,
} from './editorGeo';

const square = (x: number, y: number, size = 1): Ring => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size],
];
const poly = (ring: Ring): PolyGeom => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });

describe('classifyNeighbor / findNeighbors', () => {
  it('reads a shared vertex as a land border', () => {
    // Two squares sharing the x = 1 edge, as Natural Earth neighbours do.
    expect(classifyNeighbor(poly(square(0, 0)), poly(square(1, 0)))).toEqual({ type: 'land', distanceKm: 0 });
  });

  it('reads a narrow strait as a sea lane and open water as nothing', () => {
    const a = poly(square(0, 0));
    const strait = classifyNeighbor(a, poly(square(1.1, 0))); // ~11 km at the equator
    expect(strait?.type).toBe('sea');
    expect(strait?.distanceKm).toBeGreaterThan(10);
    expect(strait?.distanceKm).toBeLessThan(12);
    expect(classifyNeighbor(a, poly(square(3, 0)))).toBeNull(); // ~220 km
  });

  it('lists neighbours closest first and can leave the straits out', () => {
    const subject = poly(square(0, 0));
    const others = [
      { id: 'strait', geometry: poly(square(1.2, 0)) },
      { id: 'border', geometry: poly(square(0, 1)) },
      { id: 'far', geometry: poly(square(5, 5)) },
    ];
    expect(findNeighbors(subject, others).map((n) => n.id)).toEqual(['border', 'strait']);
    expect(findNeighbors(subject, others, { includeSea: false }).map((n) => n.id)).toEqual(['border']);
  });
});

describe('bridgeComponents', () => {
  it('joins every component to the growing mainland by the closest coast', () => {
    const geometries = new Map<string, PolyGeom>([
      ['a', poly(square(0, 0))],
      ['b', poly(square(1, 0))],
      ['island', poly(square(2, 2))], // 1° north of b's corner, further from a
      ['far', poly(square(2, 6))], // 3° north of the island: nearer to it than to the mainland
    ]);
    const edges = bridgeComponents([['a', 'b'], ['island'], ['far']], geometries);
    expect(edges.map((e) => [e.from, e.to, e.type])).toEqual([
      ['b', 'island', 'sea'],
      ['island', 'far', 'sea'],
    ]);
  });

  it('has nothing to do for one component', () => {
    expect(bridgeComponents([['a']], new Map())).toEqual([]);
  });
});

describe('ringSelfIntersects', () => {
  it('passes a square and refuses a bow-tie', () => {
    expect(ringSelfIntersects(square(0, 0))).toBe(false);
    expect(ringSelfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true);
  });
});

describe('ringOverlaps / trimRing', () => {
  it('measures how much of a drawn ring lies on existing territories', () => {
    const drawn = square(0, 0, 2);
    const overlaps = ringOverlaps(drawn, [
      { id: 'half', geometry: poly([[0, 0], [1, 0], [1, 2], [0, 2]]) },
      { id: 'elsewhere', geometry: poly(square(10, 10)) },
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('half');
    expect(overlaps[0].fraction).toBeCloseTo(0.5, 2);
  });

  it('cuts the overlap out and keeps the largest piece', () => {
    const drawn = square(0, 0, 2);
    const trimmed = trimRing(drawn, [poly([[0, 0], [1, 0], [1, 2], [0, 2]])]);
    expect(trimmed).not.toBeNull();
    expect(ringAreaKm2(trimmed!)).toBeCloseTo(ringAreaKm2(drawn) / 2, 0);
    for (const [lng] of trimmed!) expect(lng).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('returns null when nothing is left', () => {
    expect(trimRing(square(0, 0), [poly(square(-1, -1, 3))])).toBeNull();
  });
});

describe('largestExteriorRing / geometryLabelPoint', () => {
  it('picks the biggest polygon of a multipolygon and centres the label on it', () => {
    const geom: PolyGeom = {
      type: 'MultiPolygon',
      coordinates: [
        [[...square(10, 10), [10, 10]]],
        [[...square(0, 0, 4), [0, 0]]],
      ],
    };
    expect(largestExteriorRing(geom)).toEqual(square(0, 0, 4));
    const [lng, lat] = geometryLabelPoint(geom);
    expect(lng).toBeCloseTo(2);
    expect(lat).toBeCloseTo(2);
  });
});

describe('regionStats / suggestRegionBonus', () => {
  it('counts members and the ones that border another region', () => {
    const stats = regionStats(
      [
        { territory_id: 'a', region_id: 'west' },
        { territory_id: 'b', region_id: 'west' },
        { territory_id: 'c', region_id: 'east' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    );
    expect(stats.get('west')).toEqual({ size: 2, borders: 1 });
    expect(stats.get('east')).toEqual({ size: 1, borders: 1 });
  });

  it('lands on the classic board within one, and never pays a lone territory', () => {
    expect(suggestRegionBonus(9, 3)).toBe(5); // North America
    expect(suggestRegionBonus(12, 5)).toBe(7); // Asia
    expect(suggestRegionBonus(4, 2)).toBe(2); // South America
    expect(suggestRegionBonus(4, 1)).toBe(2); // Australia
    expect(suggestRegionBonus(6, 3)).toBe(4); // Africa is 3
    expect(suggestRegionBonus(1, 1)).toBe(0);
    expect(suggestRegionBonus(2, 0)).toBe(1);
  });
});

describe('cameraBbox / wrapLng', () => {
  it('boxes a continent the usual way when it does not cross the antimeridian', () => {
    expect(cameraBbox([poly(square(-10, 40, 5)), poly(square(20, 50, 5))]))
      .toEqual({ minLng: -10, minLat: 40, maxLng: 25, maxLat: 55 });
  });

  it('boxes the Pacific the short way round when a member straddles the antimeridian', () => {
    // Australia and New Zealand, roughly, and an island group split at 180° the way Natural Earth splits Fiji.
    const box = cameraBbox([
      poly(square(115, -35, 35)),
      poly(square(166, -46, 12)),
      poly(square(177, -19, 3)),
      poly(square(-180, -19, 2)),
    ]);
    expect(box).toEqual({ minLng: 115, minLat: -46, maxLng: 182, maxLat: 0 });
    // The centre the camera flies to is over the Coral Sea, not the Atlantic.
    expect(wrapLng((box!.minLng + box!.maxLng) / 2)).toBeCloseTo(148.5);
  });

  it('is null with nothing to box, and wraps longitudes past 180 back round', () => {
    expect(cameraBbox([])).toBeNull();
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(45)).toBe(45);
  });
});

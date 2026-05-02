import { describe, it, expect } from 'vitest';
import { galaxyExoWideHullCapResolution } from './galaxyGlobeCapResolution';

describe('galaxyExoWideHullCapResolution', () => {
  it('returns null when lng span is within planar-safe range', () => {
    const g: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-98.99, 13.1],
          [-98.99, 41.6],
          [-49.86, 43.23],
          [12.96, 23.96],
          [12.96, -5.34],
          [-70.61, -5.34],
          [-98.99, 13.1],
        ],
      ],
    };
    expect(galaxyExoWideHullCapResolution(g)).toBeNull();
  });

  it('raises resolution past the narrow bbox axis for >180° lng hulls (Rust Belt Voronoi)', () => {
    const g: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [50.16, 13.97686],
          [-64.97204, -3.40573],
          [-118.50006, 2.30864],
          [-170.16, 19.64123],
          [-170.16, 19.72],
          [50.16, 19.72],
          [50.16, 13.97686],
        ],
      ],
    };
    const r = galaxyExoWideHullCapResolution(g);
    expect(r).not.toBeNull();
    // Lat span ~23°, lng ~220° → narrow axis ~23° → resolution just above → ~25°.
    expect(r!).toBeGreaterThanOrEqual(24);
    expect(r!).toBeLessThanOrEqual(27);
  });
});

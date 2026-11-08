import { describe, it, expect } from 'vitest';
import { previewProjector, previewRing, previewUsesGeography } from './mapPreviewProjection';

const canvasMap = {
  canvas_width: 1200,
  canvas_height: 700,
  territories: [{ polygon: [[0, 0], [600, 0], [600, 350]] as [number, number][], center_point: [300, 100] as [number, number] }],
};

const geoMap = {
  canvas_width: 1200,
  canvas_height: 700,
  territories: [
    { polygon: [[-10, 40], [10, 40], [10, 60], [-10, 60]] as [number, number][], center_point: [0, 50] as [number, number], iso_codes: ['FR'] },
    { polygon: [[0, 0], [1, 0], [1, 1]] as [number, number][], center_point: [0.5, 0.5] as [number, number], geo_polygon: [[10, 40], [30, 40], [30, 60]] as [number, number][] },
  ],
};

describe('mapPreviewProjection', () => {
  it('keeps built-in boards on their canvas scale', () => {
    expect(previewUsesGeography(canvasMap)).toBe(false);
    const { project, geography } = previewProjector(canvasMap, 600, 350);
    expect(geography).toBe(false);
    expect(project([600, 350])).toEqual([300, 175]);
  });

  it('fits an editor map\'s geography into the box, north up, using drawn rings where they exist', () => {
    expect(previewUsesGeography(geoMap)).toBe(true);
    expect(previewRing(geoMap.territories[1], true)).toEqual(geoMap.territories[1].geo_polygon);
    expect(previewRing(geoMap.territories[1], false)).toEqual(geoMap.territories[1].polygon);
    const { project } = previewProjector(geoMap, 400, 200);
    const [westX, northY] = project([-10, 60]);
    const [eastX, southY] = project([30, 40]);
    expect(westX).toBeLessThan(eastX);
    expect(northY).toBeLessThan(southY);
    // Everything lands inside the box.
    for (const p of [[-10, 60], [30, 40], [-10, 40], [30, 60]] as [number, number][]) {
      const [x, y] = project(p);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(200);
    }
  });

  it('leaves an authored canvas projection alone even when rings carry geography', () => {
    expect(previewUsesGeography({ ...geoMap, projection_bounds: { minLng: -10, maxLng: 30, minLat: 40, maxLat: 60 } })).toBe(false);
  });
});

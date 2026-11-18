import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  previewCenter,
  previewProjector,
  previewRing,
  previewUsesGeography,
  type PreviewMapLike,
  type PreviewTerritoryLike,
} from './mapPreviewProjection';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it("draws a Voronoi board's land, not its cell, placed by the board's projection", () => {
    const cell: [number, number][] = [[0, 0], [600, 0], [600, 700], [0, 700]];
    const board = {
      canvas_width: 1200,
      canvas_height: 700,
      projection_bounds: { minLng: 0, maxLng: 12, minLat: 40, maxLat: 47 },
      territories: [
        // A clip cell: the canvas polygon is the cell, the geo_polygon is the land.
        {
          polygon: cell,
          center_point: [300, 350] as [number, number],
          clip_polygon: [[[0, 40], [6, 40], [6, 47], [0, 47]]],
          geo_polygon: [[1, 41], [3, 41], [3, 43]] as [number, number][],
        },
        // An ordinary territory keeps its canvas polygon.
        { polygon: cell, center_point: [300, 350] as [number, number], geo_polygon: [[1, 41], [3, 41], [3, 43]] as [number, number][] },
      ],
    };
    expect(previewUsesGeography(board)).toBe(false);
    expect(previewRing(board.territories[0], false, board)).toEqual([[100, 600], [300, 600], [300, 400]]);
    expect(previewRing(board.territories[1], false, board)).toEqual(cell);
    // Without the map, as before.
    expect(previewRing(board.territories[0], false)).toEqual(cell);
    // Its dot sits on its land (the triangle's centroid), not at its cell's centre out at sea.
    const [x, y] = previewCenter(board.territories[0], board);
    expect(x).toBeCloseTo(700 / 3);
    expect(y).toBeCloseTo(1600 / 3);
    expect(previewCenter(board.territories[1], board)).toEqual([300, 350]);
  });

  it.each([
    'community_sengoku_japan',
    'community_roman_empire_117',
    'community_mongol_empire',
    'community_napoleonic_europe',
  ])('previews %s as its land: no outline is its whole cell (bake_land_outlines.py)', (mapId) => {
    type Board = PreviewMapLike & {
      territories: (PreviewTerritoryLike & { territory_id: string; clip_polygon: number[][][] })[];
    };
    const map = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8'),
    ) as Board;
    const area = (r: number[][]) =>
      Math.abs(r.reduce((s, [x, y], i) => { const [nx, ny] = r[(i + 1) % r.length]; return s + x * ny - nx * y; }, 0)) / 2;
    let land = 0;
    let cells = 0;
    for (const t of map.territories) {
      const ring = previewRing(t, false, map);
      expect(ring, t.territory_id).not.toEqual(t.polygon);
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(map.canvas_width + 1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(map.canvas_height + 1);
      }
      land += area(t.geo_polygon!);
      cells += area(t.clip_polygon[0]);
    }
    // The cells tile the board; its land is a share of it (Sengoku Japan 13%, the Mongol Empire 80%).
    expect(land / cells).toBeLessThan(0.9);
  });
});

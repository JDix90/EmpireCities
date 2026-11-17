import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionLabelGap, separateRegionLabels, type BoardBounds } from './regionLabelSpacing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MapJson {
  projection_bounds: BoardBounds;
  territories: { region_id: string; geo_polygon: [number, number][] }[];
  regions: { region_id: string }[];
}

/** Each region's label where GlobeMap puts it before spacing: the mean of its territories' centres. */
function regionCentroids(mapId: string): { map: MapJson; labels: { id: string; lat: number; lng: number }[] } {
  const map = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8'),
  ) as MapJson;
  const labels = map.regions.map((r) => {
    const centres = map.territories
      .filter((t) => t.region_id === r.region_id)
      .map((t) => {
        const ring = t.geo_polygon;
        return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      });
    return {
      id: r.region_id,
      lng: centres.reduce((s, c) => s + c[0], 0) / centres.length,
      lat: centres.reduce((s, c) => s + c[1], 0) / centres.length,
    };
  });
  return { map, labels };
}

describe('region label spacing', () => {
  it('keeps the world spacing on a world board', () => {
    expect(regionLabelGap(null)).toEqual({ lat: 1.6, lng: 7 });
    const [a, b] = separateRegionLabels([{ lat: 40, lng: 10 }, { lat: 40.5, lng: 12 }], null);
    expect(a).toEqual({ lat: 40, lng: 10 });
    expect(b).toEqual({ lat: 38.4, lng: 12 });
  });

  it('still parts two coinciding labels on a regional board, by a label-height of that board', () => {
    // The tutorial's Italy board: the Tyrrhenian and Adriatic coasts' centres nearly coincide.
    const italy = { minLng: 6.2, maxLng: 18.9, minLat: 37.5, maxLat: 47.5 };
    const gap = regionLabelGap(italy);
    expect(gap.lat).toBeCloseTo(0.3);
    const [a, b] = separateRegionLabels([{ lat: 42.4, lng: 12.0 }, { lat: 42.5, lng: 12.6 }], italy);
    expect(a.lat - b.lat).toBeCloseTo(gap.lat);
  });

  it('keeps every Sengoku Japan region label on the board and near its region', () => {
    // World spacing walked Shikoku, Kinki and Tōkai & Kai into the Pacific, a label at a time.
    const { map, labels } = regionCentroids('community_sengoku_japan');
    const b = map.projection_bounds;
    const before = separateRegionLabels(labels, null);
    expect(before.some((l, i) => Math.abs(l.lat - labels[i].lat) > 2)).toBe(true);

    const after = separateRegionLabels(labels, b);
    after.forEach((l, i) => {
      expect(l.lat, labels[i].id).toBeGreaterThanOrEqual(b.minLat);
      expect(l.lat, labels[i].id).toBeLessThanOrEqual(b.maxLat);
      // At most one label-height off its region's centre.
      expect(Math.abs(l.lat - labels[i].lat), labels[i].id).toBeLessThanOrEqual(regionLabelGap(b).lat + 1e-9);
    });
  });

  it('nudges north instead when south would leave the board', () => {
    const board = { minLng: 0, maxLng: 10, minLat: 0, maxLat: 10 };
    const [, b] = separateRegionLabels([{ lat: 0.2, lng: 5 }, { lat: 0.3, lng: 5.5 }], board);
    expect(b.lat).toBeCloseTo(0.5);
  });
});

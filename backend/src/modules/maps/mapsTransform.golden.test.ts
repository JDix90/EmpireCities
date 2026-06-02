/**
 * Golden-snapshot tests for the PostgreSQL → TypeScript transformation layer.
 *
 * These tests are intentionally pure (no DB, no HTTP) so they run fast in CI
 * and alongside the existing unit suite.  They guard against accidental drift
 * in rowToGameMap / rowToSummary — the two functions that translate a Postgres
 * row into the shapes the rest of the app (game socket, routes, frontend)
 * depends on.
 *
 * On first run Vitest writes snapshot files under __snapshots__/.
 * To regenerate them after an intentional change: pnpm run test:backend -- --update-snapshots
 */

import { describe, it, expect } from 'vitest';
import { rowToGameMap, rowToSummary } from '../../db/postgres/mapsRepository';
import type { MapRow } from '../../db/postgres/mapsRepository';
import { stripVolatile } from './goldenNormalizer';

// ── Shared fixture row ────────────────────────────────────────────────────────

const TERRITORY_A = {
  territory_id: 'france',
  name: 'France',
  polygon: [[0, 0], [100, 0], [100, 80], [0, 80]] as [number, number][],
  center_point: [50, 40] as [number, number],
  region_id: 'western_europe',
};

const TERRITORY_B = {
  territory_id: 'england',
  name: 'England',
  polygon: [[110, 0], [200, 0], [200, 60], [110, 60]] as [number, number][],
  center_point: [155, 30] as [number, number],
  region_id: 'western_europe',
};

const BASE_ROW: MapRow = {
  map_id: 'era_medieval',
  creator_id: 'system',
  name: 'Medieval World (1200 AD)',
  description: 'The age of the Mongol conquests, Crusades, and feudal kingdoms.',
  era_theme: 'medieval',
  background_image_url: null,
  canvas_width: 1200,
  canvas_height: 700,
  projection_bounds: { minLng: -20, maxLng: 145, minLat: -5, maxLat: 72 },
  globe_view: { lock_rotation: false, center_lat: 35, center_lng: 20, altitude: 1.8 },
  map_kind: null,
  worlds: null,
  orbit_access: null,
  rts_terrain: null,
  territories: [TERRITORY_A, TERRITORY_B],
  connections: [{ from: 'france', to: 'england', type: 'sea' }],
  regions: [{ region_id: 'western_europe', name: 'Western Europe', bonus: 3 }],
  is_public: true,
  is_moderated: true,
  moderation_status: 'approved',
  rating: 4.2,
  rating_count: 15,
  play_count: 100,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

// ── rowToGameMap ──────────────────────────────────────────────────────────────

describe('rowToGameMap — golden snapshot', () => {
  it('full row transforms to expected GameMap shape (snapshot)', () => {
    const result = rowToGameMap(BASE_ROW);
    // Strip created_at so the snapshot doesn't change when test dates change.
    const { created_at: _created_at, ...stable } = result;
    expect(stable).toMatchSnapshot();
  });

  it('defaults era_theme to "custom" when null', () => {
    const result = rowToGameMap({ ...BASE_ROW, era_theme: null });
    expect(result.era_theme).toBe('custom');
  });

  it('defaults description to empty string when null', () => {
    const result = rowToGameMap({ ...BASE_ROW, description: null as unknown as string });
    expect(result.description).toBe('');
  });

  it('computes rating_sum as rating × rating_count', () => {
    expect(rowToGameMap({ ...BASE_ROW, rating: 4.0, rating_count: 10 }).rating_sum).toBe(40);
    expect(rowToGameMap({ ...BASE_ROW, rating: 0, rating_count: 0 }).rating_sum).toBe(0);
    expect(rowToGameMap({ ...BASE_ROW, rating: 3.5, rating_count: 20 }).rating_sum).toBe(70);
  });

  it('converts null optional JSONB fields to undefined (no leaked nulls)', () => {
    const result = rowToGameMap({
      ...BASE_ROW,
      projection_bounds: null,
      globe_view: null,
      map_kind: null,
      worlds: null,
      orbit_access: null,
    });
    expect(result.projection_bounds).toBeUndefined();
    expect(result.globe_view).toBeUndefined();
    expect(result.map_kind).toBeUndefined();
    expect(result.worlds).toBeUndefined();
    expect(result.orbit_access).toBeUndefined();
  });

  it('preserves territories, connections, regions verbatim', () => {
    const result = rowToGameMap(BASE_ROW);
    expect(result.territories).toHaveLength(2);
    expect(result.territories[0].territory_id).toBe('france');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].type).toBe('sea');
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].bonus).toBe(3);
  });
});

// ── rowToSummary ──────────────────────────────────────────────────────────────

describe('rowToSummary — golden snapshot', () => {
  it('full row transforms to expected MapSummary shape (snapshot)', () => {
    expect(rowToSummary(BASE_ROW)).toMatchSnapshot();
  });

  it('derives territory_count from territories array length', () => {
    const oneTerritory = { ...BASE_ROW, territories: [TERRITORY_A] };
    expect(rowToSummary(oneTerritory).territory_count).toBe(1);
    const twoTerritories = { ...BASE_ROW, territories: [TERRITORY_A, TERRITORY_B] };
    expect(rowToSummary(twoTerritories).territory_count).toBe(2);
  });

  it('derives region_count from regions array length', () => {
    const twoRegions = {
      ...BASE_ROW,
      regions: [
        { region_id: 'r1', name: 'R1', bonus: 2 },
        { region_id: 'r2', name: 'R2', bonus: 3 },
      ],
    };
    expect(rowToSummary(twoRegions).region_count).toBe(2);
  });

  it('coerces string rating column to number for avg_rating', () => {
    const r = { ...BASE_ROW, rating: '3.7' as unknown as number };
    expect(typeof rowToSummary(r).avg_rating).toBe('number');
    expect(rowToSummary(r).avg_rating).toBeCloseTo(3.7);
  });

  it('defaults era_theme to "custom" when null', () => {
    const r = { ...BASE_ROW, era_theme: null };
    expect(rowToSummary(r).era_theme).toBe('custom');
  });
});

// ── stripVolatile (normalizer utility) ───────────────────────────────────────

describe('stripVolatile', () => {
  it('removes created_at, updated_at, background_image_url', () => {
    const obj = {
      map_id: 'x',
      name: 'Test',
      created_at: new Date(),
      updated_at: new Date(),
      background_image_url: 'https://example.com/img.png',
    };
    const stripped = stripVolatile(obj);
    expect(stripped).not.toHaveProperty('created_at');
    expect(stripped).not.toHaveProperty('updated_at');
    expect(stripped).not.toHaveProperty('background_image_url');
    expect(stripped.map_id).toBe('x');
    expect(stripped.name).toBe('Test');
  });

  it('leaves all other keys intact', () => {
    const obj = { a: 1, b: 'two', c: true, created_at: new Date() };
    const stripped = stripVolatile(obj);
    expect(Object.keys(stripped)).toEqual(['a', 'b', 'c']);
  });
});

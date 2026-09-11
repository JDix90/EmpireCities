import { describe, it, expect } from 'vitest';
import { clipGlobeEligible, clipGlobeTerritoryIds, type ClipGlobeMapInput } from './useClipGlobeData';

const map = (over: Partial<ClipGlobeMapInput> = {}): ClipGlobeMapInput => ({
  map_id: 'era_ancient',
  territories: [],
  ...over,
});

describe('clipGlobeEligible', () => {
  it('accepts a territory carrying inline geometry', () => {
    expect(
      clipGlobeEligible(
        map({ territories: [{ territory_id: 'x', geo_polygon: [[0, 0]] } as never] }),
      ),
    ).toBe(true);
  });

  it('accepts a territory the geo mapping knows by id', () => {
    // era_ancient's territories resolve through TERRITORY_GEO_CONFIG rather
    // than carrying geometry inline.
    expect(clipGlobeEligible(map({ territories: [{ territory_id: 'britannia' }] }))).toBe(true);
  });

  it('rejects a canvas-only map with no geo hints at all', () => {
    expect(clipGlobeEligible(map({ territories: [{ territory_id: 'made_up_tile' }] }))).toBe(false);
  });

  it('rejects galaxy boards, which are four worlds rather than one globe', () => {
    expect(
      clipGlobeEligible(map({ map_kind: 'galaxy', territories: [{ territory_id: 'britannia' }] })),
    ).toBe(false);
  });
});

describe('clipGlobeTerritoryIds', () => {
  it('keeps Earth land and drops sea lanes', () => {
    // Sea lanes are routes, not ground — painting them owner-colored would
    // colour in the ocean.
    const ids = clipGlobeTerritoryIds(
      map({
        territories: [
          { territory_id: 'gaul', region_id: 'europe' },
          { territory_id: 'atlantic_lane', region_id: 'sea_routes' },
        ],
      }),
    );
    expect(ids).toEqual(['gaul']);
  });

  it('drops off-world tiles, which live on their own sphere', () => {
    const ids = clipGlobeTerritoryIds(
      map({
        territories: [
          { territory_id: 'gaul', region_id: 'europe' },
          { territory_id: 'moon_polar_north', region_id: 'lunar_surface' },
          { territory_id: 'sea_of_tranquility', region_id: 'lunar_surface', globe_id: 'moon' },
        ],
      }),
    );
    expect(ids).toEqual(['gaul']);
  });

  it('treats a territory with no region as Earth land', () => {
    expect(clipGlobeTerritoryIds(map({ territories: [{ territory_id: 'gaul' }] }))).toEqual(['gaul']);
  });
});

import { describe, it, expect } from 'vitest';
import { selectCanonicalEraMaps, MapSummary } from './mapService';

const m = (map_id: string, era_theme: string): MapSummary => ({
  map_id, era_theme, name: map_id, description: '', territory_count: 0,
  region_count: 0, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system',
});

describe('selectCanonicalEraMaps', () => {
  const regionalIds = new Set(['community_charlemagne_814', 'community_fractured_china']);

  it('drops regional maps and custom/unknown themes, dedupes, and orders chronologically', () => {
    const input = [
      m('era_modern', 'modern'),
      m('community_charlemagne_814', 'custom'), // regional → drop
      m('era_ancient', 'ancient'),
      m('community_fractured_china', 'ww2'),    // regional id → drop (was the dup WWII)
      m('weird_map', 'custom'),                 // custom → drop
      m('era_ww2', 'ww2'),
      m('era_ww2_dup', 'ww2'),                  // duplicate theme → drop
      m('era_medieval', 'medieval'),
      m('mystery', 'not_a_real_era'),           // unknown theme → drop
    ];
    const out = selectCanonicalEraMaps(input, regionalIds).map((x) => x.era_theme);
    expect(out).toEqual(['ancient', 'medieval', 'ww2', 'modern']);
  });

  it('keeps the first map for a duplicated theme', () => {
    const out = selectCanonicalEraMaps([m('a', 'ww2'), m('b', 'ww2')], new Set());
    expect(out).toHaveLength(1);
    expect(out[0].map_id).toBe('a');
  });
});

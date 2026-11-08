import { describe, it, expect } from 'vitest';
import { FEATURED_POOL_SIZE, isoWeekKey, pickFeaturedMap, rankFeaturedCandidates } from './featuredMap';

const map = (map_id: string, rating: number, play_count = 0, created_at = '2026-01-01T00:00:00Z') => ({
  map_id, rating, rating_count: 3, play_count, created_at,
});

describe('isoWeekKey', () => {
  it('names ISO weeks in UTC, including the year boundary', () => {
    expect(isoWeekKey(new Date('2026-11-08T12:00:00Z'))).toBe('2026-W45');
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('rankFeaturedCandidates / pickFeaturedMap', () => {
  it('ranks by rating, then plays, then age', () => {
    const ranked = rankFeaturedCandidates([
      map('low', 3.1, 500),
      map('top_new', 4.8, 10, '2026-06-01T00:00:00Z'),
      map('top_old', 4.8, 10, '2026-02-01T00:00:00Z'),
      map('top_played', 4.8, 40),
    ]);
    expect(ranked.map((m) => m.map_id)).toEqual(['top_played', 'top_old', 'top_new', 'low']);
  });

  it('picks the same map all week and nothing from nothing', () => {
    const pool = Array.from({ length: 15 }, (_, i) => map(`m${i}`, 5 - i * 0.1));
    const a = pickFeaturedMap(pool, '2026-W45');
    const b = pickFeaturedMap(pool, '2026-W45');
    expect(a).toBe(b);
    expect(pickFeaturedMap([], '2026-W45')).toBeNull();
  });

  it('only ever picks from the best-rated pool, and moves between weeks', () => {
    const pool = Array.from({ length: 25 }, (_, i) => map(`m${i}`, 5 - i * 0.1));
    const picks = new Set<string>();
    for (let w = 1; w <= 30; w++) {
      const pick = pickFeaturedMap(pool, `2026-W${String(w).padStart(2, '0')}`)!;
      expect(Number(pick.map_id.slice(1))).toBeLessThan(FEATURED_POOL_SIZE);
      picks.add(pick.map_id);
    }
    expect(picks.size).toBeGreaterThan(3);
  });
});

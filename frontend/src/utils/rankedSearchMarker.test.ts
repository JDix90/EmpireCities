import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRankedSearchMarker,
  setRankedSearchMarker,
  clearRankedSearchMarker,
  sanitizeRankedSearchMarker,
} from './rankedSearchMarker';

describe('rankedSearchMarker', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips set → get → clear', () => {
    setRankedSearchMarker('ancient', 'blitz_120');
    const marker = getRankedSearchMarker();
    expect(marker).toMatchObject({ era_id: 'ancient', bucket: 'blitz_120' });
    expect(marker!.queued_at).toBeGreaterThan(0);
    clearRankedSearchMarker();
    expect(getRankedSearchMarker()).toBeNull();
  });

  it('rejects garbage shapes and bad timestamps', () => {
    expect(sanitizeRankedSearchMarker(null)).toBeNull();
    expect(sanitizeRankedSearchMarker('junk')).toBeNull();
    expect(sanitizeRankedSearchMarker({ queued_at: 'yesterday' })).toBeNull();
    expect(sanitizeRankedSearchMarker({ queued_at: -5 })).toBeNull();
    expect(sanitizeRankedSearchMarker({ queued_at: NaN })).toBeNull();
  });

  it('treats a stale marker (>10h) as absent', () => {
    const stale = { queued_at: Date.now() - 11 * 60 * 60 * 1000, era_id: 'ww2', bucket: 'blitz_120' };
    expect(sanitizeRankedSearchMarker(stale)).toBeNull();
    localStorage.setItem('cc-ranked-search', JSON.stringify(stale));
    expect(getRankedSearchMarker()).toBeNull();
  });

  it('bad stored JSON reads as absent', () => {
    localStorage.setItem('cc-ranked-search', '{nope');
    expect(getRankedSearchMarker()).toBeNull();
  });
});

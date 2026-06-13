import { describe, it, expect } from 'vitest';
import { resolveRatingType } from './statsManager';

describe('resolveRatingType', () => {
  it('uses a dedicated key for ranked era-advancement games', () => {
    expect(resolveRatingType(true, true)).toBe('ranked_era_advancement');
  });

  it('uses the base ranked key for ranked non-era games', () => {
    expect(resolveRatingType(true, false)).toBe('ranked');
  });

  it('uses solo for any unranked game regardless of era advancement', () => {
    expect(resolveRatingType(false, true)).toBe('solo');
    expect(resolveRatingType(false, false)).toBe('solo');
  });
});

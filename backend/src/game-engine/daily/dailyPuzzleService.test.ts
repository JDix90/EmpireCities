import { describe, it, expect } from 'vitest';
import { buildDailyPuzzleBase } from './dailyPuzzleService';

describe('buildDailyPuzzleBase', () => {
  it('is deterministic for the same UTC calendar date', () => {
    const a = buildDailyPuzzleBase('2026-04-20');
    const b = buildDailyPuzzleBase('2026-04-20');
    expect(a).toEqual(b);
  });

  it('differs across calendar dates', () => {
    const a = buildDailyPuzzleBase('2026-04-20');
    const b = buildDailyPuzzleBase('2026-04-21');
    expect(a.seed).not.toBe(b.seed);
  });
});

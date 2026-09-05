import { describe, it, expect } from 'vitest';
import { isPrewarmWindow, tomorrowsDailyDate } from './dailyPrewarmService';

describe('daily pre-warm', () => {
  it('opens its window at 23:30 UTC', () => {
    expect(isPrewarmWindow(new Date('2026-09-14T23:29:59Z'))).toBe(false);
    expect(isPrewarmWindow(new Date('2026-09-14T23:30:00Z'))).toBe(true);
    expect(isPrewarmWindow(new Date('2026-09-14T00:05:00Z'))).toBe(false);
  });

  it('names tomorrow by the UTC calendar, across month and year ends', () => {
    expect(tomorrowsDailyDate(new Date('2026-09-14T23:45:00Z'))).toBe('2026-09-15');
    expect(tomorrowsDailyDate(new Date('2026-09-30T23:45:00Z'))).toBe('2026-10-01');
    expect(tomorrowsDailyDate(new Date('2026-12-31T23:45:00Z'))).toBe('2027-01-01');
  });
});

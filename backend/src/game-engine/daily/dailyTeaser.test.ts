/**
 * Tomorrow's Daily Challenge named ahead (comeback_hook_enabled): generated
 * once an hour per process at most, shared by concurrent requests, and a
 * failure is no teaser rather than an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensure = vi.hoisted(() => vi.fn());
vi.mock('./dailyPuzzleService', () => ({
  ensureDailyChallengeForDate: (date: string) => ensure(date),
  dailyChallengeDate: (now: Date = new Date()) => now.toISOString().slice(0, 10),
}));
const query = vi.hoisted(() => vi.fn(async () => [{ n: 14 }]));
vi.mock('../../db/postgres', () => ({ query: (...a: unknown[]) => query(...(a as [])) }));

import { dailyPlayersOn, resetDailyTeaserForTests, tomorrowsDailyTeaser } from './dailyTeaser';

const at = (iso: string) => new Date(iso);

describe('tomorrowsDailyTeaser', () => {
  beforeEach(() => {
    resetDailyTeaserForTests();
    ensure.mockReset().mockImplementation(async (date: string) => ({
      challenge_date: date, era_id: 'medieval', spec: { title: 'The Ottoman Gates' },
    }));
  });

  it('names tomorrow\'s challenge: its date, title and era', async () => {
    expect(await tomorrowsDailyTeaser(at('2026-11-12T10:00:00Z'))).toEqual({ date: '2026-11-13', title: 'The Ottoman Gates', era_id: 'medieval' });
    expect(ensure).toHaveBeenCalledWith('2026-11-13');
  });

  it('generates once an hour, shares a run between concurrent requests, and moves on with the date', async () => {
    const now = at('2026-11-12T10:00:00Z');
    await Promise.all([tomorrowsDailyTeaser(now), tomorrowsDailyTeaser(now), tomorrowsDailyTeaser(now)]);
    await tomorrowsDailyTeaser(at('2026-11-12T10:30:00Z'));
    expect(ensure).toHaveBeenCalledTimes(1);
    await tomorrowsDailyTeaser(at('2026-11-12T11:01:00Z'));
    expect(ensure).toHaveBeenCalledTimes(2);
    await tomorrowsDailyTeaser(at('2026-11-13T00:05:00Z'));
    expect(ensure).toHaveBeenLastCalledWith('2026-11-14');
  });

  it('gives no teaser when generation fails or the day has no title', async () => {
    ensure.mockRejectedValueOnce(new Error('calibration failed'));
    expect(await tomorrowsDailyTeaser(at('2026-11-12T10:00:00Z'))).toBeNull();
    resetDailyTeaserForTests();
    ensure.mockResolvedValueOnce({ challenge_date: '2026-11-13', era_id: 'ww2', spec: {} });
    expect(await tomorrowsDailyTeaser(at('2026-11-12T10:00:00Z'))).toBeNull();
  });
});

describe('dailyPlayersOn', () => {
  it('counts the players who finished that day\'s challenge, test accounts left out', async () => {
    expect(await dailyPlayersOn('2026-11-11')).toBe(14);
    const [sql, params] = query.mock.calls.at(-1) as unknown as [string, unknown[]];
    expect(sql).toContain('COUNT(DISTINCT dce.user_id)');
    expect(sql).toContain('exclude_from_stats');
    expect(params).toEqual(['2026-11-11']);
  });
});

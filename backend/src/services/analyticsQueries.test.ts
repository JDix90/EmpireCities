import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));

import {
  getFunnelMetrics,
  getCompletionStats,
  getEventVolume,
  getAcquisitionBySource,
  getAnalyticsReport,
} from './analyticsQueries';

describe('analyticsQueries', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
  });

  it('getFunnelMetrics targets the signup cohort, passes the window, coerces to numbers', async () => {
    queryMock.mockResolvedValueOnce([
      { signups: 10, created_game: 7, started_game: 6, finished_game: 4, upgraded: 2 },
    ]);
    const f = await getFunnelMetrics(14);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('analytics_events');
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    expect(params).toEqual([14]);
    expect(f).toEqual({ signups: 10, created_game: 7, started_game: 6, finished_game: 4, upgraded: 2 });
  });

  it('getFunnelMetrics defaults a missing row to zeros', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getFunnelMetrics(30)).toEqual({
      signups: 0,
      created_game: 0,
      started_game: 0,
      finished_game: 0,
      upgraded: 0,
    });
  });

  it('getCompletionStats coerces numeric strings and preserves null averages', async () => {
    queryMock.mockResolvedValueOnce([
      { finishes: 5, wins: 2, tutorial_finishes: 1, avg_minutes: '22.4', avg_turns: null },
    ]);
    expect(await getCompletionStats(30)).toEqual({
      finishes: 5,
      wins: 2,
      tutorial_finishes: 1,
      avg_minutes: 22.4,
      avg_turns: null,
    });
  });

  it('getEventVolume maps rows to {event, n}', async () => {
    queryMock.mockResolvedValueOnce([
      { event: 'game_started', n: 12 },
      { event: 'guest_created', n: 9 },
    ]);
    expect(await getEventVolume(7)).toEqual([
      { event: 'game_started', n: 12 },
      { event: 'guest_created', n: 9 },
    ]);
  });

  it('getAcquisitionBySource coalesces source, passes the window, maps counts', async () => {
    queryMock.mockResolvedValueOnce([
      { source: 'reddit', signups: 6, accounts: 2, activated: 1 },
      { source: 'direct', signups: 4, accounts: 0, activated: 0 },
    ]);
    const a = await getAcquisitionBySource(14);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("COALESCE(NULLIF(properties->>'utm_source', '')");
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    expect(params).toEqual([14]);
    expect(a).toEqual([
      { source: 'reddit', signups: 6, accounts: 2, activated: 1 },
      { source: 'direct', signups: 4, accounts: 0, activated: 0 },
    ]);
  });

  it('getAnalyticsReport assembles every section plus the lifetime total', async () => {
    // Promise.all invokes the section queries in array order:
    // funnel, retention, completion, acquisition, volume — then queryOne(total).
    queryMock
      .mockResolvedValueOnce([{ signups: 3, created_game: 2, started_game: 2, finished_game: 1, upgraded: 0 }])
      .mockResolvedValueOnce([{ d1_cohort: 3, d1: 1, d7_cohort: 0, d7: 0 }])
      .mockResolvedValueOnce([{ finishes: 1, wins: 1, tutorial_finishes: 0, avg_minutes: '15.0', avg_turns: '20.0' }])
      .mockResolvedValueOnce([{ source: 'reddit', signups: 3, accounts: 1, activated: 1 }])
      .mockResolvedValueOnce([{ event: 'game_finished', n: 1 }]);
    queryOneMock.mockResolvedValueOnce({ total: 42 });

    const r = await getAnalyticsReport(30);
    expect(r.window_days).toBe(30);
    expect(r.total_events).toBe(42);
    expect(r.funnel.finished_game).toBe(1);
    expect(r.retention.d1).toBe(1);
    expect(r.completion.avg_minutes).toBe(15);
    expect(r.acquisition).toEqual([{ source: 'reddit', signups: 3, accounts: 1, activated: 1 }]);
    expect(r.volume).toEqual([{ event: 'game_finished', n: 1 }]);
  });
});

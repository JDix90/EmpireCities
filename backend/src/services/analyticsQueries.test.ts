import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));

import {
  getRetentionByCohort,
  getFunnelMetrics,
  getVisitorFunnel,
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
      { signups: 10, created_game: 7, started_game: 6, map_rendered: 6, first_attack: 5, first_capture: 4, finished_game: 4, upgraded: 2 },
    ]);
    const f = await getFunnelMetrics(14);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('analytics_events');
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    // The first-session activation steps are part of the funnel query.
    expect(sql).toContain("e.event = 'map_rendered'");
    expect(sql).toContain("e.event = 'first_attack'");
    expect(sql).toContain("e.event = 'first_territory_captured'");
    expect(params).toEqual([14]);
    expect(f).toEqual({ signups: 10, created_game: 7, started_game: 6, map_rendered: 6, first_attack: 5, first_capture: 4, finished_game: 4, upgraded: 2 });
  });

  it('getFunnelMetrics defaults a missing row to zeros', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getFunnelMetrics(30)).toEqual({
      signups: 0,
      created_game: 0,
      started_game: 0,
      map_rendered: 0,
      first_attack: 0,
      first_capture: 0,
      finished_game: 0,
      upgraded: 0,
    });
  });

  it('getRetentionByCohort splits on the same account test the acquisition table uses', async () => {
    queryMock.mockResolvedValueOnce([
      { is_account: true, d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1 },
      { is_account: false, d1_cohort: 21, d1: 0, d7_cohort: 16, d7: 0 },
    ]);
    const rows = await getRetentionByCohort();
    const [sql] = queryMock.mock.calls[0] as [string];
    // Same predicate as getAcquisitionBySource's `accounts` column — if these
    // ever diverge the two readouts disagree about who has an account.
    expect(sql).toContain("e.event IN ('user_registered', 'guest_upgraded')");
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    expect(rows).toEqual([
      { cohort: 'account', d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1 },
      { cohort: 'guest', d1_cohort: 21, d1: 0, d7_cohort: 16, d7: 0 },
    ]);
  });

  it('getRetentionByCohort always returns both cohorts, account first', async () => {
    // Postgres GROUP BY emits no row for an empty cohort; callers render a
    // fixed two-row table, so the zero-fill has to happen here.
    queryMock.mockResolvedValueOnce([
      { is_account: false, d1_cohort: 9, d1: 0, d7_cohort: 5, d7: 0 },
    ]);
    expect(await getRetentionByCohort()).toEqual([
      { cohort: 'account', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0 },
      { cohort: 'guest', d1_cohort: 9, d1: 0, d7_cohort: 5, d7: 0 },
    ]);
  });

  it('getRetentionByCohort zero-fills an empty table', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getRetentionByCohort()).toEqual([
      { cohort: 'account', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0 },
      { cohort: 'guest', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0 },
    ]);
  });

  it('getRetentionByCohort coerces numeric strings from the driver', async () => {
    queryMock.mockResolvedValueOnce([
      { is_account: true, d1_cohort: '4', d1: '3', d7_cohort: '2', d7: '1' },
    ]);
    const [account] = await getRetentionByCohort();
    expect(account).toEqual({ cohort: 'account', d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1 });
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
      { source: 'reddit', channel: 'social', signups: 6, accounts: 2, activated: 1 },
      { source: 'direct', channel: 'direct', signups: 4, accounts: 0, activated: 0 },
    ]);
  });

  it('getVisitorFunnel counts distinct anon sessions and stitches signups', async () => {
    queryMock.mockResolvedValueOnce([{ landed: 12, clicked_play: 5, signed_up: 3 }]);
    const v = await getVisitorFunnel(7);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("event = 'landing_viewed'");
    expect(sql).toContain("event = 'hero_play_clicked'");
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    expect(sql).toContain("properties->>'anon_session_id'");
    expect(params).toEqual([7]);
    expect(v).toEqual({ landed: 12, clicked_play: 5, signed_up: 3 });
  });

  it('getVisitorFunnel defaults a missing row to zeros', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getVisitorFunnel(30)).toEqual({ landed: 0, clicked_play: 0, signed_up: 0 });
  });

  it('getAnalyticsReport assembles every section plus the lifetime total', async () => {
    // Promise.all invokes the section queries in array order: visitors, funnel,
    // retention, retention-by-cohort, completion, acquisition, volume — then
    // queryOne(total). The order is positional, so inserting a section here
    // without adding its row shifts every later mock onto the wrong query.
    queryMock
      .mockResolvedValueOnce([{ landed: 10, clicked_play: 4, signed_up: 3 }])
      .mockResolvedValueOnce([{ signups: 3, created_game: 2, started_game: 2, finished_game: 1, upgraded: 0 }])
      .mockResolvedValueOnce([{ d1_cohort: 3, d1: 1, d7_cohort: 0, d7: 0 }])
      .mockResolvedValueOnce([
        { is_account: true, d1_cohort: 1, d1: 1, d7_cohort: 0, d7: 0 },
        { is_account: false, d1_cohort: 2, d1: 0, d7_cohort: 0, d7: 0 },
      ])
      .mockResolvedValueOnce([{ finishes: 1, wins: 1, tutorial_finishes: 0, avg_minutes: '15.0', avg_turns: '20.0' }])
      .mockResolvedValueOnce([{ source: 'reddit', signups: 3, accounts: 1, activated: 1 }])
      .mockResolvedValueOnce([{ event: 'game_finished', n: 1 }]);
    queryOneMock.mockResolvedValueOnce({ total: 42 });

    const r = await getAnalyticsReport(30);
    expect(r.window_days).toBe(30);
    expect(r.total_events).toBe(42);
    expect(r.visitors).toEqual({ landed: 10, clicked_play: 4, signed_up: 3 });
    expect(r.funnel.finished_game).toBe(1);
    expect(r.retention.d1).toBe(1);
    // The pooled row and the split must describe the same cohort: 1 of 3 back
    // on day one, and all of that one is the account side.
    expect(r.retention_by_cohort).toEqual([
      { cohort: 'account', d1_cohort: 1, d1: 1, d7_cohort: 0, d7: 0 },
      { cohort: 'guest', d1_cohort: 2, d1: 0, d7_cohort: 0, d7: 0 },
    ]);
    expect(r.completion.avg_minutes).toBe(15);
    expect(r.acquisition).toEqual([
      { source: 'reddit', channel: 'social', signups: 3, accounts: 1, activated: 1 },
    ]);
    // The same signups folded up by channel — the grain that answers "is the
    // assistant-referral channel growing?" rather than "how did this campaign do?".
    expect(r.acquisition_channels).toEqual([
      {
        channel: 'social',
        label: 'Social / community',
        signups: 3,
        accounts: 1,
        activated: 1,
        sources: ['reddit'],
      },
    ]);
    expect(r.volume).toEqual([{ event: 'game_finished', n: 1 }]);
  });
});

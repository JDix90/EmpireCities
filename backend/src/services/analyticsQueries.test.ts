import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));

import {
  getActivePlayers,
  getRetentionMetrics,
  getRetentionByCohort,
  getTutorialFunnel,
  getFunnelMetrics,
  getVisitorFunnel,
  getCompletionStats,
  getFirstMatchStats,
  getSoloGamesByLevel,
  getEventVolume,
  getAcquisitionBySource,
  getAnalyticsReport,
  getGuestAccountMetrics,
  parseFunnelDevice,
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
    expect(params).toEqual([14, null]);
    expect(f).toEqual({ signups: 10, created_game: 7, started_game: 6, map_rendered: 6, first_attack: 5, first_capture: 4, finished_game: 4, upgraded: 2 });
  });

  it('getFunnelMetrics counts real games only after signup, and narrows to a signup device', async () => {
    queryMock.mockResolvedValueOnce([]);
    await getFunnelMetrics(7, 'phone');
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    // The tutorial fires these events too; the funnel's steps must not count it.
    for (const ev of ['game_started', 'map_rendered', 'first_attack', 'first_territory_captured', 'game_finished']) {
      expect(sql).toContain(`e.event = '${ev}' AND COALESCE(e.properties->>'is_tutorial', 'false') <> 'true'`);
    }
    // The device is the one recorded on the signup event; null keeps everyone.
    expect(sql).toContain("($2::text IS NULL OR properties->>'device' = $2::text)");
    expect(params).toEqual([7, 'phone']);
  });

  it('parseFunnelDevice accepts the three device classes and nothing else', () => {
    expect(parseFunnelDevice('phone')).toBe('phone');
    expect(parseFunnelDevice('tablet')).toBe('tablet');
    expect(parseFunnelDevice('desktop')).toBe('desktop');
    expect(parseFunnelDevice('all')).toBeNull();
    expect(parseFunnelDevice(undefined)).toBeNull();
    expect(parseFunnelDevice("phone' OR 1=1")).toBeNull();
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
      { is_account: true, d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1, d30_cohort: 1, d30: 1 },
      { is_account: false, d1_cohort: 21, d1: 0, d7_cohort: 16, d7: 0 },
    ]);
    const rows = await getRetentionByCohort();
    const [sql] = queryMock.mock.calls[0] as [string];
    // Same predicate as getAcquisitionBySource's `accounts` column — if these
    // ever diverge the two readouts disagree about who has an account.
    expect(sql).toContain("e.event IN ('user_registered', 'guest_upgraded')");
    expect(sql).toContain("event IN ('guest_created', 'user_registered')");
    expect(rows).toEqual([
      { cohort: 'account', d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1, d30_cohort: 1, d30: 1 },
      { cohort: 'guest', d1_cohort: 21, d1: 0, d7_cohort: 16, d7: 0, d30_cohort: 0, d30: 0 },
    ]);
  });

  it('counts as a return only what the player did, on day 1, 7 and 30', async () => {
    queryMock.mockResolvedValue([]);
    await getRetentionMetrics();
    await getRetentionByCohort();
    for (const [sql] of queryMock.mock.calls as Array<[string]>) {
      for (const n of [1, 7, 30]) {
        expect(sql).toContain(`d0 <= CURRENT_DATE - ${n})::int AS d${n}_cohort`);
        expect(sql).toMatch(new RegExp(`d0 \\+ ${n}\\s+AND e\\.event NOT IN \\('retention_notification_sent', 'seat_player_away', 'email_unsubscribed'\\)`));
      }
    }
    // The split takes a list of signups to limit itself to; null is everyone.
    expect(queryMock.mock.calls[1]![1]).toEqual([null]);
  });

  it('getRetentionByCohort always returns both cohorts, account first', async () => {
    // Postgres GROUP BY emits no row for an empty cohort; callers render a
    // fixed two-row table, so the zero-fill has to happen here.
    queryMock.mockResolvedValueOnce([
      { is_account: false, d1_cohort: 9, d1: 0, d7_cohort: 5, d7: 0 },
    ]);
    expect(await getRetentionByCohort()).toEqual([
      { cohort: 'account', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
      { cohort: 'guest', d1_cohort: 9, d1: 0, d7_cohort: 5, d7: 0, d30_cohort: 0, d30: 0 },
    ]);
  });

  it('getRetentionByCohort zero-fills an empty table', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getRetentionByCohort()).toEqual([
      { cohort: 'account', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
      { cohort: 'guest', d1_cohort: 0, d1: 0, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
    ]);
  });

  it('getRetentionByCohort coerces numeric strings from the driver', async () => {
    queryMock.mockResolvedValueOnce([
      { is_account: true, d1_cohort: '4', d1: '3', d7_cohort: '2', d7: '1' },
    ]);
    const [account] = await getRetentionByCohort();
    expect(account).toEqual({ cohort: 'account', d1_cohort: 4, d1: 3, d7_cohort: 2, d7: 1, d30_cohort: 0, d30: 0 });
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

  it('getTutorialFunnel splits completion on the same account test as retention', async () => {
    queryMock.mockResolvedValueOnce([
      { is_account: true, started: 8, completed: 6 },
      { is_account: false, started: 30, completed: 9 },
    ]);
    const rows = await getTutorialFunnel(30);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    // Both ends of the funnel are the server-side events, not client pings.
    expect(sql).toContain("event = 'tutorial_started'");
    expect(sql).toContain("e.event = 'tutorial_completed'");
    // The same guest/account test the retention split uses.
    expect(sql).toContain("e.event IN ('user_registered', 'guest_upgraded')");
    // Leaving from the wrap-up card after playing the lesson counts as completed:
    // that path abandons the tutorial game, so the server event never fires.
    expect(sql).toContain("e.event = 'tutorial_exited' AND e.properties->>'via' IN ('wrapup', 'wrapup_to_match')");
    expect(params).toEqual([30, null]);
    expect(rows).toEqual([
      { cohort: 'account', started: 8, completed: 6 },
      { cohort: 'guest', started: 30, completed: 9 },
    ]);
  });

  it('getTutorialFunnel always returns both cohorts, zeroed when one is empty', async () => {
    queryMock.mockResolvedValueOnce([{ is_account: false, started: 4, completed: 0 }]);
    expect(await getTutorialFunnel(7)).toEqual([
      { cohort: 'account', started: 0, completed: 0 },
      { cohort: 'guest', started: 4, completed: 0 },
    ]);
  });

  it('getTutorialFunnel counts a starter only once however many lessons they open', async () => {
    queryMock.mockResolvedValueOnce([]);
    await getTutorialFunnel(30);
    const [sql] = queryMock.mock.calls[0] as [string];
    // GROUP BY user_id in the starters CTE — five lesson modules is one player.
    expect(sql).toContain('GROUP BY user_id');
  });

  it('getFirstMatchStats reads the first-match tag on both events and applies the D1 rule', async () => {
    queryMock.mockResolvedValueOnce([{ started: 5, finished: 4, won: 3, next_day_cohort: 3, next_day: 2 }]);
    const r = await getFirstMatchStats(14);
    expect(r).toEqual({ started: 5, finished: 4, won: 3, next_day_cohort: 3, next_day: 2 });
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(params).toEqual([14]);
    expect(sql).toMatch(/event = 'game_created'/);
    expect(sql).toMatch(/event = 'game_finished'/);
    expect(String(sql).match(/properties->>'first_match'/g)).toHaveLength(2);
    // A finish only joins the next-day cohort once its next day can have happened.
    expect(sql).toMatch(/d0 <= CURRENT_DATE - 1/);
    expect(sql).toMatch(/e\.created_at::date = f\.d0 \+ 1\s+AND e\.event NOT IN \('retention_notification_sent'/);
  });

  it('getFirstMatchStats reads zeros on an empty window', async () => {
    queryMock.mockResolvedValueOnce([{}]);
    expect(await getFirstMatchStats(30)).toEqual({ started: 0, finished: 0, won: 0, next_day_cohort: 0, next_day: 0 });
  });

  it('getSoloGamesByLevel reads one-human games with bots, by mode and level, in a fixed order', async () => {
    queryMock.mockResolvedValueOnce([
      { mode: 'other', level_rank: 4, started: 3, finished: 2, won: 0, abandoned: 1, running: 0, capped: 0, surrendered: 0, median_rounds: 31, bot_captures: '20', bot_captures_from_human: 9, bot_captures_from_leader: 7, bot_captures_from_weakest: 5 },
      { mode: 'other', level_rank: 1, started: '9', finished: '7', won: '6', abandoned: '1', running: '1', capped: '4', surrendered: '2', median_rounds: '60' },
      { mode: 'campaign', level_rank: 2, started: 2, finished: 0, won: 0, abandoned: 0, running: 2, capped: 0, surrendered: 0, median_rounds: null },
      { mode: 'tutorial', level_rank: 0, started: 5, finished: 4, won: 4, abandoned: 1, running: 0, capped: 0, surrendered: 0, median_rounds: 12 },
    ]);
    const rows = await getSoloGamesByLevel(30);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([30]);
    // Exactly one human and at least one bot, admin and test games left out.
    expect(sql).toContain('seats.humans = 1 AND seats.bots > 0');
    expect(sql).toContain('sx_gp.game_id = g.game_id');
    // A round-cap ending is the turn_limit victory on the game's finish event.
    expect(sql).toContain("f.victory_type = 'turn_limit'");
    // A surrender win is the surrender ending on the same event.
    expect(sql).toContain("f.victory_type = 'surrender'");
    expect(sql).toContain("event = 'game_finished'");
    // Where the bots' captures came from rides on the same event.
    expect(sql).toContain("properties->>'ai_captures_from_players'");
    // The level is the highest bot's, ranked lowest to highest.
    expect(sql).toContain("WHEN 'tutorial' THEN 0 WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 WHEN 'expert' THEN 4");
    expect(rows).toEqual([
      { mode: 'tutorial', level: 'tutorial', started: 5, finished: 4, won: 4, abandoned: 1, running: 0, capped: 0, surrendered: 0, median_rounds: 12, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'campaign', level: 'medium', started: 2, finished: 0, won: 0, abandoned: 0, running: 2, capped: 0, surrendered: 0, median_rounds: null, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'other', level: 'easy', started: 9, finished: 7, won: 6, abandoned: 1, running: 1, capped: 4, surrendered: 2, median_rounds: 60, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
      { mode: 'other', level: 'expert', started: 3, finished: 2, won: 0, abandoned: 1, running: 0, capped: 0, surrendered: 0, median_rounds: 31, bot_captures: 20, bot_captures_from_human: 9, bot_captures_from_leader: 7, bot_captures_from_weakest: 5 },
    ]);
  });

  it('getSoloGamesByLevel returns no rows for an empty window', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await getSoloGamesByLevel(7)).toEqual([]);
  });

  it('getAnalyticsReport assembles every section plus the lifetime total', async () => {
    // Promise.all invokes the section queries in array order: visitors, funnel,
    // retention, retention-by-cohort, completion, acquisition, volume,
    // tutorial, first matches, solo games by level — and queryOne(total), mocked separately. The order is positional, so inserting a
    // section anywhere but the end
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
      .mockResolvedValueOnce([{ event: 'game_finished', n: 1 }])
      .mockResolvedValueOnce([
        { is_account: true, started: 2, completed: 2 },
        { is_account: false, started: 5, completed: 1 },
      ])
      .mockResolvedValueOnce([{ started: 4, finished: 3, won: 2, next_day_cohort: 2, next_day: 1 }])
      .mockResolvedValueOnce([
        { mode: 'other', level_rank: 3, started: 2, finished: 1, won: 1, abandoned: 1, running: 0, capped: 1, surrendered: 0, median_rounds: 60 },
      ])
      .mockResolvedValueOnce([{ saved: 2, saved_with_password: 1, saved_email_only: 1, links_sent: 1, link_signins: 1 }])
      .mockResolvedValueOnce([{ used_personal_cohort: 2, used_personal_saved: 1, other_guest_cohort: 3, other_guest_saved: 1 }])
      .mockResolvedValueOnce([{ yesterday: 4, last_7_days: 9, last_30_days: 20 }])
      .mockResolvedValueOnce([{ day: '2026-10-18', active: 5, new_players: 2 }]);
    queryOneMock.mockResolvedValueOnce({ total: 42 });

    const r = await getAnalyticsReport(30);
    expect(r.window_days).toBe(30);
    expect(r.device).toBeNull();
    expect(r.total_events).toBe(42);
    expect(r.visitors).toEqual({ landed: 10, clicked_play: 4, signed_up: 3 });
    expect(r.funnel.finished_game).toBe(1);
    expect(r.retention.d1).toBe(1);
    // The pooled row and the split must describe the same cohort: 1 of 3 back
    // on day one, and all of that one is the account side.
    expect(r.retention_by_cohort).toEqual([
      { cohort: 'account', d1_cohort: 1, d1: 1, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
      { cohort: 'guest', d1_cohort: 2, d1: 0, d7_cohort: 0, d7: 0, d30_cohort: 0, d30: 0 },
    ]);
    expect(r.tutorial).toEqual([
      { cohort: 'account', started: 2, completed: 2 },
      { cohort: 'guest', started: 5, completed: 1 },
    ]);
    expect(r.completion.avg_minutes).toBe(15);
    expect(r.first_match).toEqual({ started: 4, finished: 3, won: 2, next_day_cohort: 2, next_day: 1 });
    expect(r.solo_by_level).toEqual([
      { mode: 'other', level: 'hard', started: 2, finished: 1, won: 1, abandoned: 1, running: 0, capped: 1, surrendered: 0, median_rounds: 60, bot_captures: 0, bot_captures_from_human: 0, bot_captures_from_leader: 0, bot_captures_from_weakest: 0 },
    ]);
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
    expect(r.guest_accounts).toMatchObject({
      saved: 2, saved_with_password: 1, saved_email_only: 1, links_sent: 1, link_signins: 1, links_not_sent: 0,
      used_personal_cohort: 2, used_personal_saved: 1, other_guest_cohort: 3, other_guest_saved: 1,
    });
    expect(r.active_players).toEqual({
      yesterday: 4,
      last_7_days: 9,
      last_30_days: 20,
      daily: [{ day: '2026-10-18', active: 5, new_players: 2, returning_players: 3 }],
    });
  });

  it('getActivePlayers counts distinct players who did something, and splits each day into new and returning', async () => {
    queryMock
      .mockResolvedValueOnce([{ yesterday: '3', last_7_days: '7', last_30_days: '12' }])
      .mockResolvedValueOnce([
        { day: '2026-10-17', active: 0, new_players: 0 },
        { day: '2026-10-18', active: '6', new_players: '1' },
      ]);
    const r = await getActivePlayers(2);
    expect(r).toEqual({
      yesterday: 3,
      last_7_days: 7,
      last_30_days: 12,
      daily: [
        { day: '2026-10-17', active: 0, new_players: 0, returning_players: 0 },
        { day: '2026-10-18', active: 6, new_players: 1, returning_players: 5 },
      ],
    });
    const [[totalsSql, totalsParams], [dailySql, dailyParams]] = queryMock.mock.calls as Array<[string, unknown[]]>;
    for (const sql of [totalsSql, dailySql]) {
      expect(sql).toContain('COUNT');
      expect(sql).toContain("e.event NOT IN ('retention_notification_sent', 'seat_player_away', 'email_unsubscribed')");
      expect(sql).toContain('e.user_id IS NOT NULL');
      // Admin and test accounts are left out, as everywhere else.
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM users sx_eu WHERE sx_eu.user_id = e.user_id');
    }
    expect(totalsSql).toContain('CURRENT_DATE - 29');
    expect(totalsSql).toContain('day = CURRENT_DATE - 1');
    expect(totalsSql).toContain('day >= CURRENT_DATE - 6');
    expect(totalsParams).toEqual([null]);
    // Every day of the window gets a row, empty days included.
    expect(dailySql).toContain("generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day')");
    expect(dailySql).toContain('u.created_at::date = d.day');
    expect(dailyParams).toEqual([2, null]);
  });

  it('getActivePlayers reads zeros and an empty series from empty results', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await getActivePlayers(30, ['00000000-0000-0000-0000-000000000001'])).toEqual({
      yesterday: 0, last_7_days: 0, last_30_days: 0, daily: [],
    });
    expect(queryMock.mock.calls[1]![1]).toEqual([30, ['00000000-0000-0000-0000-000000000001']]);
  });

  it('getGuestAccountMetrics counts saves, sign-in links and guests using their things in the window', async () => {
    queryMock
      .mockResolvedValueOnce([{
        saved: '5', saved_with_password: 2, saved_email_only: 3, links_sent: 4, links_not_sent: 1,
        link_requests_no_account: 2, link_signins: 3, link_failures: 1, guests_viewed_achievements: 6, guests_equipped: 2,
      }])
      .mockResolvedValueOnce([{ used_personal_cohort: 6, used_personal_saved: 3, other_guest_cohort: 10, other_guest_saved: 1 }]);

    const m = await getGuestAccountMetrics(7);

    expect(m).toEqual({
      saved: 5, saved_with_password: 2, saved_email_only: 3, links_sent: 4, links_not_sent: 1,
      link_requests_no_account: 2, link_signins: 3, link_failures: 1, guests_viewed_achievements: 6, guests_equipped: 2,
      used_personal_cohort: 6, used_personal_saved: 3, other_guest_cohort: 10, other_guest_saved: 1,
    });
    const [counts, countParams] = queryMock.mock.calls[0] as [string, unknown[]];
    const [split, splitParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(countParams).toEqual([7]);
    expect(splitParams).toEqual([7]);
    // The events the guest-account changes record, read the way they are written.
    expect(counts).toContain("event = 'guest_upgraded' AND properties->>'with_password' = 'true'");
    expect(counts).toContain("event = 'sign_in_link_requested' AND properties->>'matched' = 'false'");
    expect(counts).toContain("event = 'user_login' AND properties->>'method' = 'email_link'");
    expect(counts).toContain("event = 'cosmetic_equipped' AND properties->>'is_guest' = 'true'");
    // Left-out accounts (admins, testers) count nowhere, as in every other section.
    expect(counts).toContain('NOT EXISTS (SELECT 1 FROM users sx_eu');
    expect(split).toContain("e.event IN ('achievements_viewed', 'cosmetic_equipped')");
    expect(split).toContain("e.event = 'guest_upgraded'");
  });

  it('getGuestAccountMetrics reads an empty window as zeros', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const m = await getGuestAccountMetrics(30);
    expect(Object.values(m).every((n) => n === 0)).toBe(true);
  });
});

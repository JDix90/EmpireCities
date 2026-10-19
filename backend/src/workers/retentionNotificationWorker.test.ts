import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => ({
  Queue: class {
    upsertJobScheduler = vi.fn();
    close = vi.fn();
  },
  Worker: class {
    on = vi.fn();
    close = vi.fn();
  },
}));

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
}));

let flagOn = true;
let guestFlagOn = false;
vi.mock('../config/featureFlags', () => ({
  featureFlags: {
    get retentionNotificationsEnabled() {
      return flagOn;
    },
    get guestPushRemindersEnabled() {
      return guestFlagOn;
    },
  },
}));

const pushMock = vi.fn();
const emailMock = vi.fn();
let pushConfigured = true;
vi.mock('../services/notificationService', () => ({
  isPushConfigured: async () => pushConfigured,
  sendPushNotification: (...a: unknown[]) => pushMock(...a),
  sendEngagementEmail: (...a: unknown[]) => emailMock(...a),
}));

const eventMock = vi.fn();
vi.mock('../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => eventMock(...a),
}));

import { runRetentionSweep } from './retentionNotificationWorker';

const CANDIDATE = {
  user_id: 'u-1',
  daily_streak: 3,
  push_enabled: true,
  email_enabled: true,
  has_push_token: true,
};

const claims = () => queryOneMock.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO retention_notifications'));

describe('runRetentionSweep', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    pushMock.mockReset();
    emailMock.mockReset();
    eventMock.mockReset();
    flagOn = true;
    guestFlagOn = false;
    pushConfigured = true;
    queryMock.mockResolvedValue([]);
    queryOneMock.mockResolvedValue({ id: 'claim-1' }); // claim succeeds
    pushMock.mockResolvedValue(1);
    emailMock.mockResolvedValue(true);
  });

  it('does nothing when the feature flag is off', async () => {
    flagOn = false;
    const res = await runRetentionSweep(12);
    expect(res).toEqual({ streak: 0, daily: 0, winback: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('sends a streak-at-risk push and records the analytics event', async () => {
    queryMock.mockResolvedValueOnce([CANDIDATE]); // streak candidates
    const res = await runRetentionSweep(12); // 12 ≠ daily/winback hours
    expect(res.streak).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [userId, title] = pushMock.mock.calls[0];
    expect(userId).toBe('u-1');
    expect(title).toContain('3-day streak');
    expect(emailMock).not.toHaveBeenCalled();
    expect(eventMock).toHaveBeenCalledWith(
      'retention_notification_sent',
      { trigger: 'streak_at_risk', channel: 'push' },
      'u-1',
    );
  });

  it('falls back to email when the user is unreachable by push', async () => {
    queryMock.mockResolvedValueOnce([CANDIDATE]);
    pushMock.mockResolvedValue(0); // no device tokens
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(1);
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(eventMock).toHaveBeenCalledWith(
      'retention_notification_sent',
      { trigger: 'streak_at_risk', channel: 'email' },
      'u-1',
    );
  });

  it('sends nothing when the daily claim slot is already taken', async () => {
    queryMock.mockResolvedValueOnce([CANDIDATE]);
    queryOneMock.mockResolvedValue(null); // ON CONFLICT DO NOTHING → no row
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(0);
    expect(pushMock).not.toHaveBeenCalled();
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('only runs the win-back phase at its UTC hour', async () => {
    // Hour 12: streak query only.
    await runRetentionSweep(12);
    expect(queryMock).toHaveBeenCalledTimes(1);

    queryMock.mockClear();
    // Hour 15: streak + winback d2 + winback d7 queries.
    await runRetentionSweep(15);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('only runs the daily-challenge phase at its UTC hour', async () => {
    await runRetentionSweep(17);
    // streak + daily challenge candidate queries
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('leaves the slot alone for a daily-challenge push the player cannot receive', async () => {
    // At 17:00 UTC the streak query (first) finds no one, the daily one finds a
    // player with no device. They must keep their slot for the streak
    // reminder due later in the day.
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...CANDIDATE, has_push_token: false }]);
    const res = await runRetentionSweep(17);
    expect(res.daily).toBe(0);
    expect(claims()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('UPDATE retention_notifications'))).toBe(false);
  });

  it('sends the streak reminder by email to a player with no device, without trying push', async () => {
    queryMock.mockResolvedValueOnce([{ ...CANDIDATE, has_push_token: false }]);
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(1);
    expect(claims()).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
    expect(emailMock).toHaveBeenCalledTimes(1);
  });

  it('claims nothing for a player neither channel can reach', async () => {
    queryMock.mockResolvedValueOnce([{ ...CANDIDATE, has_push_token: false, email_enabled: false }]);
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(0);
    expect(claims()).toHaveLength(0);
  });

  it('without push configured, counts no one as reachable by push', async () => {
    pushConfigured = false;
    queryMock
      .mockResolvedValueOnce([{ ...CANDIDATE, email_enabled: false }]) // streak: push only, so unreachable
      .mockResolvedValueOnce([CANDIDATE]); // daily
    const res = await runRetentionSweep(17);
    expect(res).toEqual({ streak: 0, daily: 0, winback: 0 });
    expect(claims()).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
    // Both queries were told, so the database leaves those players out too.
    const [[streakSql, streakParams], [dailySql, dailyParams]] = queryMock.mock.calls as Array<[string, unknown[]]>;
    expect(streakParams).toEqual([false, false]);
    expect(dailyParams).toEqual([false, false]);
    for (const sql of [streakSql, dailySql]) {
      expect(sql).toContain('EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = u.user_id)');
    }
    expect(streakSql).toContain('AND COALESCE(p.email_notifications, false))');
  });

  it('leaves guests out of every phase while guest_push_reminders_enabled is off', async () => {
    await runRetentionSweep(17);
    await runRetentionSweep(15);
    const calls = queryMock.mock.calls as Array<[string, unknown[] | undefined]>;
    const [[streakSql, streakParams], [dailySql, dailyParams]] = calls;
    // The guest clause is there, and the flag passed to it is off.
    for (const sql of [streakSql, dailySql]) {
      expect(sql).toContain('(COALESCE(u.is_guest, false) = false OR $2::boolean)');
    }
    expect(streakParams).toEqual([true, false]);
    expect(dailyParams).toEqual([true, false]);
    // Win-back is email, which a guest has none of: excluded whatever the flag.
    const winback = calls.filter(([sql]) => sql.includes("NOT LIKE '%@guest.local'"));
    expect(winback).toHaveLength(2);
    for (const [sql] of winback) expect(sql).toContain('WHERE COALESCE(u.is_guest, false) = false\n');
  });

  it('lets guests into the push phases, never by email, while the flag is on', async () => {
    guestFlagOn = true;
    await runRetentionSweep(17);
    const [[streakSql, streakParams], [, dailyParams]] = queryMock.mock.calls as Array<[string, unknown[]]>;
    expect(streakParams).toEqual([true, true]);
    expect(dailyParams).toEqual([true, true]);
    // The streak reminder's email branch, and the email_enabled column the
    // send reads, both count accounts only.
    expect(streakSql.match(/COALESCE\(u\.is_guest, false\) = false AND COALESCE\(p\.email_notifications, false\)/g))
      .toHaveLength(2);
  });

  it('sends a guest the streak reminder by push', async () => {
    guestFlagOn = true;
    // As the query returns a guest: email_enabled is false for every guest.
    queryMock.mockResolvedValueOnce([{ ...CANDIDATE, email_enabled: false }]);
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(emailMock).not.toHaveBeenCalled();
  });

  it('keeps the claim (marks failed) when every channel fails', async () => {
    queryMock.mockResolvedValueOnce([CANDIDATE]);
    pushMock.mockResolvedValue(0);
    emailMock.mockResolvedValue(false);
    const res = await runRetentionSweep(12);
    expect(res.streak).toBe(0);
    // markResult() UPDATE ran against retention_notifications
    const updates = queryMock.mock.calls.filter(([sql]) => String(sql).includes('UPDATE retention_notifications'));
    expect(updates.length).toBeGreaterThan(0);
    expect(eventMock).not.toHaveBeenCalled();
  });
});

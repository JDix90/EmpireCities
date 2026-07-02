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
vi.mock('../config/featureFlags', () => ({
  featureFlags: {
    get retentionNotificationsEnabled() {
      return flagOn;
    },
  },
}));

const pushMock = vi.fn();
const emailMock = vi.fn();
vi.mock('../services/notificationService', () => ({
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
};

describe('runRetentionSweep', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    pushMock.mockReset();
    emailMock.mockReset();
    eventMock.mockReset();
    flagOn = true;
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

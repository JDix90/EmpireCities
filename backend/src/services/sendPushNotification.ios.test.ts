/**
 * sendPushNotification with an iOS app token in the mix (no real APNs, FCM or
 * DB). The iOS app's token is Apple's and goes to APNs; every other token is
 * Firebase's. Neither transport is ever handed the other's token, because
 * each would call it invalid and the token would be deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fcm = vi.hoisted(() => ({ path: '' }));
const saPath = await vi.hoisted(async () => {
  const { writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const p = join(tmpdir(), `bf-fcm-ios-test-${process.pid}.json`);
  writeFileSync(p, JSON.stringify({ project_id: 'test-project' }));
  return p;
});

vi.mock('../config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config')>();
  return {
    ...mod,
    config: {
      ...mod.config,
      frontendUrl: 'https://bf.test',
      push: { ...mod.config.push, get fcmServiceAccountPath() { return fcm.path; } },
    },
  };
});

const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(() => ({})),
    credential: { cert: vi.fn((sa: unknown) => sa) },
    messaging: () => ({ sendEachForMulticast }),
  },
}));

const apns = vi.hoisted(() => ({ configured: true, send: vi.fn() }));
vi.mock('./apnsService', () => ({
  isApnsConfigured: () => apns.configured,
  getApnsSender: () => (apns.configured ? { send: (...a: unknown[]) => apns.send(...a), close: () => {} } : null),
}));

const queryMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: vi.fn(),
}));

const WEB = { token_id: 't-web', token: 'fcm-web-token', platform: 'web' };
const ANDROID = { token_id: 't-and', token: 'fcm-android-token', platform: 'android' };
const IOS = { token_id: 't-ios', token: 'a1b2c3d4'.repeat(8), platform: 'ios' };
const IOS_2 = { token_id: 't-ios2', token: '0f'.repeat(32), platform: 'ios' };

function devices(rows: Array<typeof WEB>) {
  queryMock.mockImplementation(async (sql: string) => (sql.includes('FROM push_tokens') ? rows : []));
}
function fcmAccepts(n: number) {
  sendEachForMulticast.mockResolvedValue({ successCount: n, failureCount: 0, responses: Array.from({ length: n }, () => ({ success: true })) });
}
const deleted = () => queryMock.mock.calls.filter((c) => String(c[0]).includes('DELETE FROM push_tokens')).map((c) => (c[1] as string[])[0]);

/** A fresh module each time: whether Firebase is configured is read once and kept. */
async function load(opts: { fcm: boolean; apns: boolean }) {
  vi.resetModules();
  fcm.path = opts.fcm ? saPath : '';
  apns.configured = opts.apns;
  return import('./notificationService');
}

beforeEach(() => {
  queryMock.mockReset();
  sendEachForMulticast.mockReset();
  apns.send.mockReset().mockResolvedValue({ status: 'sent', environment: 'production' });
});

describe('sendPushNotification — the iOS app', () => {
  it('sends the iOS token to APNs and the others to Firebase, and counts both', async () => {
    devices([WEB, IOS, ANDROID]);
    fcmAccepts(2);
    const { sendPushNotification } = await load({ fcm: true, apns: true });
    const n = await sendPushNotification('u1', "It's your turn!", 'Ancient Era, turn 4.', { type: 'your_turn', gameId: 'g1' }, 'https://bf.test/game/g1');
    expect(n).toBe(3);
    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(apns.send).toHaveBeenCalledWith(IOS.token, {
      title: "It's your turn!",
      body: 'Ancient Era, turn 4.',
      // The game to open, for the app's tap handler, and the same tag the web card uses.
      data: { type: 'your_turn', gameId: 'g1', url: 'https://bf.test/game/g1' },
      collapseId: 'turn-g1',
    });
    // Firebase never sees the Apple token.
    expect(sendEachForMulticast.mock.calls[0][0].tokens).toEqual([WEB.token, ANDROID.token]);
  });

  it('deletes an iOS token Apple says is gone, and keeps one that merely failed', async () => {
    devices([IOS, IOS_2]);
    apns.send
      .mockResolvedValueOnce({ status: 'gone', reason: 'Unregistered' })
      .mockResolvedValueOnce({ status: 'failed', reason: 'TooManyRequests' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendPushNotification } = await load({ fcm: true, apns: true });
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(0);
    expect(deleted()).toEqual([IOS.token_id]);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('counts an APNs send that throws as a failure, and still sends the rest', async () => {
    devices([IOS, WEB]);
    apns.send.mockRejectedValueOnce(new Error('socket hang up'));
    fcmAccepts(1);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sendPushNotification } = await load({ fcm: true, apns: true });
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(1);
    expect(deleted()).toEqual([]);
  });

  // Before APNs is configured: Firebase would answer "invalid token" for an
  // Apple token, and that answer deletes the token.
  it('leaves an iOS token alone, unsent and undeleted, while APNs is not configured', async () => {
    devices([WEB, IOS]);
    fcmAccepts(1);
    const { sendPushNotification, isPushConfigured } = await load({ fcm: true, apns: false });
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(1);
    expect(apns.send).not.toHaveBeenCalled();
    expect(sendEachForMulticast.mock.calls[0][0].tokens).toEqual([WEB.token]);
    expect(deleted()).toEqual([]);
    expect(await isPushConfigured()).toBe(true);
  });

  it('reaches the iOS app with APNs alone, on a server with no Firebase', async () => {
    devices([IOS, WEB]);
    const { sendPushNotification, isPushConfigured } = await load({ fcm: false, apns: true });
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(1);
    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(await isPushConfigured()).toBe(true);
  });

  it('with neither configured, sends nothing and does not even look the devices up', async () => {
    devices([IOS, WEB]);
    const { sendPushNotification, isPushConfigured } = await load({ fcm: false, apns: false });
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
    expect(await isPushConfigured()).toBe(false);
  });

  it('sends a player with only browsers exactly what it sent before', async () => {
    devices([WEB]);
    fcmAccepts(1);
    const { sendPushNotification } = await load({ fcm: true, apns: true });
    expect(await sendPushNotification('u1', 'T', 'B', { type: 'test' })).toBe(1);
    expect(apns.send).not.toHaveBeenCalled();
    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: [WEB.token],
      notification: { title: 'T', body: 'B' },
      data: { type: 'test' },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { icon: 'https://bf.test/icons/icon-192.png', tag: 'test', renotify: true },
        fcmOptions: { link: 'https://bf.test/lobby' },
      },
    });
  });
});

/**
 * sendPushNotification — the shape of the web card (no real FCM, no DB).
 *
 * The message carries a `notification` block so the FCM web SDK displays it
 * itself while the tab is hidden; the service worker's own handler is
 * data-only (showing there too gave two cards per turn). So everything about
 * how the card looks and behaves has to travel in `webpush.notification`:
 * a PNG icon Android's tray can render, and a tag shared with the page-side
 * notification GlobalTurnNotifier raises, so the push REPLACES that card
 * rather than stacking a second one. This pins that contract, plus the
 * existing stale-token pruning it sits next to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saPath = await vi.hoisted(async () => {
  const { writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const p = join(tmpdir(), `bf-fcm-test-${process.pid}.json`);
  writeFileSync(p, JSON.stringify({ project_id: 'test-project' }));
  return p;
});

vi.mock('../config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config')>();
  return {
    ...mod,
    config: { ...mod.config, frontendUrl: 'https://bf.test', push: { fcmServiceAccountPath: saPath } },
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

const queryMock = vi.fn();
const queryOneMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

const TOKENS = [
  { token_id: 't1', token: 'tok-1' },
  { token_id: 't2', token: 'tok-2' },
];

function tokensThen(rows: typeof TOKENS) {
  queryMock.mockImplementation(async (sql: string) => (sql.includes('FROM push_tokens') ? rows : []));
}

function accepted(n: number) {
  sendEachForMulticast.mockResolvedValue({
    successCount: n,
    failureCount: 0,
    responses: Array.from({ length: n }, () => ({ success: true })),
  });
}

async function load() {
  const mod = await import('./notificationService');
  return mod;
}

describe('sendPushNotification — web card shape', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
    sendEachForMulticast.mockReset();
  });

  it('shapes the card the SDK shows: PNG icon, the shared turn tag, high urgency, click-through to the game', async () => {
    tokensThen(TOKENS);
    accepted(2);
    const { sendPushNotification } = await load();
    const n = await sendPushNotification(
      'u1',
      "It's your turn!",
      'Ancient Era — Turn 4.',
      { type: 'your_turn', gameId: 'g1', url: 'https://bf.test/game/g1' },
      'https://bf.test/game/g1',
    );
    expect(n).toBe(2);
    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['tok-1', 'tok-2'],
      notification: { title: "It's your turn!", body: 'Ancient Era — Turn 4.' },
      data: { type: 'your_turn', gameId: 'g1', url: 'https://bf.test/game/g1' },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { icon: 'https://bf.test/icons/icon-192.png', tag: 'turn-g1', renotify: true },
        fcmOptions: { link: 'https://bf.test/game/g1' },
      },
    });
  });

  it('tags a match-found card match-<gameId>, like the page-side match notifier', async () => {
    tokensThen(TOKENS.slice(0, 1));
    accepted(1);
    const { sendPushNotification } = await load();
    await sendPushNotification('u1', 'Match found!', 'go', { type: 'match_found', gameId: 'g2' }, 'https://bf.test/game/g2');
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        webpush: expect.objectContaining({ notification: expect.objectContaining({ tag: 'match-g2' }) }),
      }),
    );
  });

  it('falls back to the lobby as the click target when no link is given', async () => {
    tokensThen(TOKENS.slice(0, 1));
    accepted(1);
    const { sendPushNotification } = await load();
    await sendPushNotification('u1', 'Test', 'body', { type: 'test' });
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        webpush: expect.objectContaining({
          notification: expect.objectContaining({ tag: 'test' }),
          fcmOptions: { link: 'https://bf.test/lobby' },
        }),
      }),
    );
  });

  it('prunes a token FCM reports as no longer registered and counts only accepted ones', async () => {
    tokensThen(TOKENS);
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const { sendPushNotification } = await load();
    const n = await sendPushNotification('u1', 'T', 'B');
    expect(n).toBe(1);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM push_tokens'), ['t2']);
  });

  it('returns 0 without calling FCM when the user has no devices', async () => {
    tokensThen([]);
    const { sendPushNotification } = await load();
    expect(await sendPushNotification('u1', 'T', 'B')).toBe(0);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe('webPushTag', () => {
  it('pairs with the page-side notifiers and never leaves renotify without a tag', async () => {
    const { webPushTag } = await load();
    expect(webPushTag({ type: 'your_turn', gameId: 'g1' })).toBe('turn-g1');
    expect(webPushTag({ gameId: 'g1' })).toBe('turn-g1'); // legacy untyped turn push
    expect(webPushTag({ type: 'match_found', gameId: 'g2' })).toBe('match-g2');
    expect(webPushTag({ type: 'test' })).toBe('test');
    expect(webPushTag()).toBe('borderfall');
  });
});

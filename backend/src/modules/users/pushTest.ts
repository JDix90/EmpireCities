// ============================================================
// "Send a test notification" — Settings → Notifications → This browser
// ============================================================
// The one way a player (or an operator) can prove push works end to end
// without waiting for an opponent to move.
// ============================================================

import { config } from '../../config';
import { queryOne } from '../../db/postgres';
import { sendPushNotification } from '../../services/notificationService';

/** Longest delay the client may ask for. */
export const TEST_PUSH_MAX_DELAY_MS = 15_000;

export interface TestPushResult {
  /** Devices registered for this account. 0 means nothing was sent. */
  registered: number;
  delay_ms: number;
  /** Devices FCM accepted the message for; null while a delayed send is still pending. */
  accepted: number | null;
}

export interface TestPushDeps {
  countDevices: (userId: string) => Promise<number>;
  send: (userId: string) => Promise<number>;
  schedule: (fn: () => void, ms: number) => void;
  warn: (message: string) => void;
}

export function testPushCopy(): { title: string; body: string; url: string } {
  return {
    title: 'Test notification',
    body: "Push is working on this device. You'll be told here when it's your turn.",
    url: `${config.frontendUrl}/settings`,
  };
}

const defaultDeps: TestPushDeps = {
  countDevices: async (userId) => {
    const row = await queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM push_tokens WHERE user_id = $1',
      [userId],
    );
    return Number(row?.n ?? 0);
  },
  send: (userId) => {
    const { title, body, url } = testPushCopy();
    return sendPushNotification(userId, title, body, { type: 'test', url }, url);
  },
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
  warn: (message) => console.warn(message),
};

/**
 * Send (or schedule) a test push to every device on the account.
 *
 * Why a delay exists: the FCM web SDK shows a system notification only while
 * the tab is HIDDEN — in front, the page receives the message as a toast.
 * What the player wants to see from a test is the lock-screen card, so the
 * client asks for a few seconds and tells them to switch away. A delayed
 * send is fire-and-forget: its outcome is logged, never returned, because the
 * response has long gone. With no delay the send is awaited and `accepted`
 * says how many devices FCM took it for — what an operator's curl wants.
 *
 * Deliberately ignores the account-level push_enabled switch: the button is
 * an explicit act and sits directly under that toggle.
 */
export async function scheduleTestPush(
  userId: string,
  delayMs: number,
  deps: TestPushDeps = defaultDeps,
): Promise<TestPushResult> {
  const delay = Math.min(Math.max(0, Math.floor(delayMs)), TEST_PUSH_MAX_DELAY_MS);
  const registered = await deps.countDevices(userId);
  if (registered === 0) return { registered: 0, delay_ms: delay, accepted: 0 };

  const warnIfUnaccepted = (accepted: number) => {
    if (accepted === 0) {
      deps.warn(
        `[Notifications] test push for ${userId}: no device accepted it (FCM not configured, or every token stale)`,
      );
    }
    return accepted;
  };

  if (delay === 0) {
    const accepted = await deps
      .send(userId)
      .then(warnIfUnaccepted)
      .catch((err) => {
        deps.warn(`[Notifications] test push for ${userId} failed: ${String(err)}`);
        return 0;
      });
    return { registered, delay_ms: 0, accepted };
  }

  deps.schedule(() => {
    deps
      .send(userId)
      .then(warnIfUnaccepted)
      .catch((err) => deps.warn(`[Notifications] delayed test push for ${userId} failed: ${String(err)}`));
  }, delay);
  return { registered, delay_ms: delay, accepted: null };
}

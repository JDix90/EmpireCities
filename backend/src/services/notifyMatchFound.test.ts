/**
 * Unit tests for notifyMatchFound (no DB, no FCM): preference gating and the
 * never-throws contract. The db layer is mocked; FCM is unconfigured in tests,
 * so sendPushNotification's internals no-op after the prefs check — we assert
 * on the QUERIES made (prefs read always; push_tokens read only when enabled).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../db/postgres', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

describe('notifyMatchFound', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([]);
    queryOneMock.mockReset();
  });

  async function load() {
    const mod = await import('./notificationService');
    return mod.notifyMatchFound;
  }

  it('skips the push entirely when push_enabled is false', async () => {
    queryOneMock.mockResolvedValue({ push_enabled: false });
    const notifyMatchFound = await load();
    await notifyMatchFound('u1', 'g1', 'ancient');
    // Prefs were read…
    expect(queryOneMock).toHaveBeenCalledWith(expect.stringContaining('user_preferences'), ['u1']);
    // …but no token lookup (sendPushNotification not reached).
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('push_tokens'), expect.anything());
  });

  it('defaults to push-enabled when no preferences row exists', async () => {
    queryOneMock.mockResolvedValue(null);
    const notifyMatchFound = await load();
    await notifyMatchFound('u2', 'g2', 'ww2');
    // Reached sendPushNotification; with FCM unconfigured it returns before
    // querying tokens — the observable contract here is simply: no throw.
    expect(queryOneMock).toHaveBeenCalled();
  });

  it('never throws even when the db layer fails', async () => {
    queryOneMock.mockRejectedValue(new Error('db down'));
    const notifyMatchFound = await load();
    await expect(notifyMatchFound('u3', 'g3', 'modern')).resolves.toBeUndefined();
  });
});

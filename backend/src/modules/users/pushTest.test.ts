/**
 * scheduleTestPush: the "Send test" button's contract, with the db and FCM
 * replaced by fakes. No devices → nothing sent and the response says 0; no
 * delay → the send is awaited and `accepted` is real; a delay → the response
 * returns at once with accepted null and the send runs later, its outcome
 * only logged. Never throws to the route.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/postgres', () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('../../services/notificationService', () => ({ sendPushNotification: vi.fn() }));

import { scheduleTestPush, testPushCopy, TEST_PUSH_MAX_DELAY_MS, type TestPushDeps } from './pushTest';

function fakes(over: Partial<TestPushDeps> = {}) {
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const deps: TestPushDeps = {
    countDevices: vi.fn(async () => 2),
    send: vi.fn(async () => 2),
    schedule: vi.fn((fn, ms) => {
      scheduled.push({ fn, ms });
    }),
    warn: vi.fn(),
    ...over,
  };
  return { deps, scheduled };
}

describe('scheduleTestPush', () => {
  it('sends nothing and says so when the account has no device', async () => {
    const { deps } = fakes({ countDevices: vi.fn(async () => 0) });
    await expect(scheduleTestPush('u1', 0, deps)).resolves.toEqual({ registered: 0, delay_ms: 0, accepted: 0 });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
  });

  it('with no delay, awaits the send and reports how many devices accepted it', async () => {
    const { deps } = fakes();
    await expect(scheduleTestPush('u1', 0, deps)).resolves.toEqual({ registered: 2, delay_ms: 0, accepted: 2 });
    expect(deps.send).toHaveBeenCalledWith('u1');
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('with a delay, answers at once and sends later — the outcome is only logged', async () => {
    const { deps, scheduled } = fakes({ send: vi.fn(async () => 0) });
    await expect(scheduleTestPush('u1', 5000, deps)).resolves.toEqual({ registered: 2, delay_ms: 5000, accepted: null });
    expect(deps.send).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(5000);

    scheduled[0].fn();
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledWith('u1'));
    await vi.waitFor(() => expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('no device accepted')));
  });

  it('clamps the delay to the maximum and floors fractions', async () => {
    const { deps, scheduled } = fakes();
    const res = await scheduleTestPush('u1', TEST_PUSH_MAX_DELAY_MS * 10, deps);
    expect(res.delay_ms).toBe(TEST_PUSH_MAX_DELAY_MS);
    expect(scheduled[0].ms).toBe(TEST_PUSH_MAX_DELAY_MS);
    const { deps: d2 } = fakes();
    expect((await scheduleTestPush('u1', 0.9, d2)).delay_ms).toBe(0);
  });

  it('turns a failed immediate send into accepted 0 plus a warning, never a throw', async () => {
    const { deps } = fakes({ send: vi.fn(async () => { throw new Error('fcm down'); }) });
    await expect(scheduleTestPush('u1', 0, deps)).resolves.toEqual({ registered: 2, delay_ms: 0, accepted: 0 });
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('fcm down'));
  });

  it('turns a failed delayed send into a warning', async () => {
    const { deps, scheduled } = fakes({ send: vi.fn(async () => { throw new Error('fcm down'); }) });
    await scheduleTestPush('u1', 1000, deps);
    scheduled[0].fn();
    await vi.waitFor(() => expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('fcm down')));
  });

  it('links the card to Settings, where the button lives', () => {
    expect(testPushCopy().url).toMatch(/\/settings$/);
  });
});

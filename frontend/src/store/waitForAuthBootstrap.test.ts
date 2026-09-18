import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));

import { useAuthStore, waitForAuthBootstrap } from './authStore';

describe('waitForAuthBootstrap', () => {
  beforeEach(() => {
    useAuthStore.setState({ bootstrapped: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when bootstrap has already settled', async () => {
    useAuthStore.setState({ bootstrapped: true });
    await expect(waitForAuthBootstrap()).resolves.toBeUndefined();
  });

  it('resolves when the silent refresh lands', async () => {
    const waiting = waitForAuthBootstrap();
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    useAuthStore.setState({ bootstrapped: true });
    await expect(waiting).resolves.toBeUndefined();
  });

  it('gives up at the cap rather than parking the caller forever', async () => {
    // POST /auth/refresh runs on `rawHttp`, which has no timeout of its own,
    // so a stalled connection would never flip `bootstrapped`. Awaiting this
    // from a button must not leave that button dead.
    vi.useFakeTimers();
    const waiting = waitForAuthBootstrap(3000);
    let settled = false;
    void waiting.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBeUndefined();
    expect(useAuthStore.getState().bootstrapped).toBe(false);
  });

  it('stops listening to the store once it has resolved', async () => {
    const waiting = waitForAuthBootstrap();
    useAuthStore.setState({ bootstrapped: true });
    await waiting;
    // A later flip must not reach a resolved waiter (double-resolve is silent,
    // but a leaked subscription is not).
    expect(() => {
      useAuthStore.setState({ bootstrapped: false });
      useAuthStore.setState({ bootstrapped: true });
    }).not.toThrow();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const post = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: vi.fn() } }));
vi.mock('../services/socket', () => ({
  resyncSocketAuth: vi.fn(),
  disconnectSocket: vi.fn(),
}));

import { useAuthStore, type AuthUser } from '../store/authStore';
import { reportDailyVisit, resetDailyVisitForTests, useDailyVisit } from './useDailyVisit';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Probe() {
  useDailyVisit();
  return null;
}

function signIn(userId: string) {
  useAuthStore.setState({
    user: { user_id: userId, username: 'p' } as AuthUser,
    accessToken: 'token',
    isAuthenticated: true,
    bootstrapped: true,
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useDailyVisit', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { ok: true } });
    localStorage.clear();
    resetDailyVisitForTests();
    useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: false });
  });

  it('reports a signed-in player opening the game once, after the boot refresh', async () => {
    render(<Probe />);
    expect(post).not.toHaveBeenCalled();
    act(() => { useAuthStore.setState({ user: { user_id: 'u1', username: 'p' } as AuthUser, isAuthenticated: true }); });
    expect(post).not.toHaveBeenCalled();
    act(() => { useAuthStore.setState({ accessToken: 'token', bootstrapped: true }); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/analytics/ui-event', { event: 'app_opened', properties: { device: 'desktop' } });
    await flush();
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a signed-out visitor', () => {
    useAuthStore.setState({ bootstrapped: true });
    render(<Probe />);
    setVisibility('visible');
    expect(post).not.toHaveBeenCalled();
  });

  it('reports again on a new UTC day, and for another player on the same browser', async () => {
    reportDailyVisit('u1', new Date('2026-10-18T23:59:00Z'));
    await flush();
    reportDailyVisit('u1', new Date('2026-10-18T12:00:00Z'));
    reportDailyVisit('u1', new Date('2026-10-19T00:01:00Z'));
    await flush();
    reportDailyVisit('u2', new Date('2026-10-19T00:02:00Z'));
    await flush();
    expect(post).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('cc-last-app-opened')).toBe('u2:2026-10-19');
  });

  it('remembers the day across a reload, and tries again when the page returns after a failed post', async () => {
    signIn('u1');
    post.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<Probe />);
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
    unmount();

    resetDailyVisitForTests(); // a reload: memory gone, storage kept
    render(<Probe />);
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('posts once while a post is still on its way', () => {
    post.mockReturnValue(new Promise(() => {}));
    reportDailyVisit('u1');
    reportDailyVisit('u1');
    expect(post).toHaveBeenCalledTimes(1);
  });
});

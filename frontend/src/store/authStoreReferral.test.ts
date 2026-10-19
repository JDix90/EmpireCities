import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useAuthStore } from './authStore';
import { useFeatureFlagsStore } from './featureFlagsStore';
import { capturePendingReferral, resetPendingReferralForTests } from '../utils/pendingReferral';

const account = (isGuest: boolean) => ({
  data: { accessToken: 't', user: { user_id: 'u1', username: 'p', level: 1, xp: 0, mmr: 1000, is_guest: isGuest } },
});

/** The redeem posts once the dynamically loaded module has run. */
async function settle() {
  for (let i = 0; i < 20 && !post.mock.calls.some(([url]) => url === '/progression/referral/redeem'); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('a referral link applies when the account is made or saved', () => {
  beforeEach(() => {
    localStorage.clear();
    post.mockReset();
    resetPendingReferralForTests();
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, player_links_play_enabled: true } }));
    window.history.pushState({}, '', '/?ref=K7Q2PX9A');
    capturePendingReferral();
    window.history.pushState({}, '', '/');
  });

  it('on registering', async () => {
    post.mockImplementation(async (url: string) => (url === '/auth/register' ? account(false) : { data: { ok: true } }));
    await useAuthStore.getState().register('newplayer', 'new@example.com', 'password123');
    await settle();
    expect(post).toHaveBeenCalledWith('/progression/referral/redeem', { code: 'K7Q2PX9A' });
  });

  it('on saving a guest account', async () => {
    post.mockImplementation(async (url: string) => (url === '/auth/upgrade' ? account(false) : { data: { ok: true } }));
    await useAuthStore.getState().upgradeAccount(undefined, 'new@example.com', undefined);
    await settle();
    expect(post).toHaveBeenCalledWith('/progression/referral/redeem', { code: 'K7Q2PX9A' });
  });

  it('not on signing in to an account that already existed', async () => {
    post.mockImplementation(async (url: string) => (url === '/auth/login' ? account(false) : { data: {} }));
    await useAuthStore.getState().login('old@example.com', 'password123');
    await new Promise((r) => setTimeout(r, 50));
    expect(post.mock.calls.some(([url]) => url === '/progression/referral/redeem')).toBe(false);
  });
});

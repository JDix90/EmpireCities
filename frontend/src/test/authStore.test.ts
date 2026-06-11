import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));
vi.mock('../services/socket', () => ({
  resyncSocketAuth: vi.fn(),
  disconnectSocket: vi.fn(),
}));

import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { resyncSocketAuth } from '../services/socket';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isLoading: false,
      isAuthenticated: false,
      bootstrapped: false,
    });
    try {
      window.localStorage.removeItem('cc-auth');
    } catch { /* ignore */ }
  });

  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });

  it('setUser updates user', () => {
    const mockUser = {
      user_id: 'u1',
      username: 'testuser',
      level: 1,
      xp: 0,
      mmr: 1000,
    };
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it('setAccessToken updates token', () => {
    useAuthStore.getState().setAccessToken('tok_123');
    expect(useAuthStore.getState().accessToken).toBe('tok_123');
  });

  it('logout clears state and marks bootstrap complete', async () => {
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'x', level: 1, xp: 0, mmr: 1000, is_guest: true },
      accessToken: 'tok',
      isAuthenticated: true,
      bootstrapped: false,
    });
    await useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.bootstrapped).toBe(true);
  });

  it('upgradeAccount swaps in the full-account identity in place', async () => {
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'Guest_abcd1234', level: 3, xp: 900, mmr: 1000, is_guest: true },
      accessToken: 'guest-token',
      isAuthenticated: true,
      bootstrapped: true,
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        accessToken: 'full-token',
        user: { user_id: 'u1', username: 'RealCommander', level: 3, xp: 900, mmr: 1000, is_guest: false },
      },
    });

    await useAuthStore.getState().upgradeAccount('RealCommander', 'cmd@example.com', 'long-password');

    const state = useAuthStore.getState();
    expect(api.post).toHaveBeenCalledWith('/auth/upgrade', {
      username: 'RealCommander', email: 'cmd@example.com', password: 'long-password',
    });
    // Same user_id (in-place conversion), progression intact, flag flipped.
    expect(state.user?.user_id).toBe('u1');
    expect(state.user?.xp).toBe(900);
    expect(state.user?.is_guest).toBe(false);
    expect(state.user?.username).toBe('RealCommander');
    expect(state.accessToken).toBe('full-token');
    // The singleton socket must drop the guest JWT for the new identity.
    expect(resyncSocketAuth).toHaveBeenCalled();
  });

  it('upgradeAccount leaves state untouched on failure', async () => {
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'Guest_abcd1234', level: 1, xp: 0, mmr: 1000, is_guest: true },
      accessToken: 'guest-token',
      isAuthenticated: true,
    });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('409'));

    await expect(
      useAuthStore.getState().upgradeAccount('Taken', 't@example.com', 'long-password'),
    ).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.user?.is_guest).toBe(true);
    expect(state.accessToken).toBe('guest-token');
    expect(state.isLoading).toBe(false);
  });

  it('does NOT persist accessToken to localStorage (XSS hardening)', async () => {
    // Set state directly, then trigger persistence by writing through the API.
    useAuthStore.setState({
      user: {
        user_id: 'u1',
        username: 'persist-test',
        level: 1,
        xp: 0,
        mmr: 1000,
      },
      accessToken: 'super-secret-jwt',
      isAuthenticated: true,
    });
    // Force a persist flush — Zustand persist writes synchronously after each setState.
    // Directly read what would have been written:
    const raw = window.localStorage.getItem('cc-auth');
    if (raw) {
      const parsed = JSON.parse(raw);
      const persisted = JSON.stringify(parsed);
      expect(persisted).not.toContain('super-secret-jwt');
      expect(persisted).not.toContain('accessToken');
    }
    // Belt-and-suspenders: a setUser call should not leak the token either.
    useAuthStore.getState().setUser({
      user_id: 'u1', username: 'persist-test', level: 1, xp: 0, mmr: 1000,
    });
    const raw2 = window.localStorage.getItem('cc-auth');
    if (raw2) {
      expect(raw2).not.toContain('super-secret-jwt');
    }
  });
});

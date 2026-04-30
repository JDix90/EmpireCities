import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../store/authStore';

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

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../store/authStore';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isLoading: false,
      isAuthenticated: false,
    });
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

  it('logout clears state', async () => {
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'x', level: 1, xp: 0, mmr: 1000, is_guest: true },
      accessToken: 'tok',
      isAuthenticated: true,
    });
    await useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});

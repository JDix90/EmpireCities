/**
 * The auth store in the native app: the session is a refresh token in the
 * device keychain, sent in the request body, instead of the website's cookie.
 * The last block runs the same store as the website, where none of it applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const native = vi.hoisted(() => ({ on: true, pluginInBuild: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
    getPlatform: () => (native.on ? 'ios' : 'web'),
    // What the native bridge lists: the plugins whose native code is in the build.
    get PluginHeaders() {
      return native.pluginInBuild ? [{ name: 'App' }, { name: 'SecureStorage' }] : [{ name: 'App' }];
    },
  },
}));
const keychain = vi.hoisted(() => ({ items: new Map<string, string>(), failing: false }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { afterFirstUnlockThisDeviceOnly: 3 },
  SecureStorage: {
    get: async (key: string) => {
      if (keychain.failing) throw new Error('keychain locked');
      return keychain.items.get(key) ?? null;
    },
    set: async (key: string, value: string) => { keychain.items.set(key, value); },
    remove: async (key: string) => keychain.items.delete(key),
  },
}));

// `rawHttp` (guest, refresh, the recovery's /users/me) and `api` (the rest).
const rawPost = vi.hoisted(() => vi.fn());
const rawGet = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => ({ post: rawPost, get: rawGet }) } };
});
const apiPost = vi.hoisted(() => vi.fn());
vi.mock('../services/api', () => ({ api: { post: apiPost, get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../services/nativeAppVersion', () => ({ attachNativeAppVersion: vi.fn() }));

const KEY = 'bf-refresh-token';
const guest = { user_id: 'g1', username: 'SteadyFox_1', is_guest: true };

function httpError(status: number, data: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, null, {
    status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
  });
}

/** A fresh store, loaded as the app or as the website would load it. */
async function loadStore(asNative: boolean) {
  native.on = asNative;
  vi.resetModules();
  const { useAuthStore } = await import('./authStore');
  const { resetNativeSessionForTests } = await import('../services/nativeSession');
  resetNativeSessionForTests();
  useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
  return useAuthStore;
}

beforeEach(() => {
  keychain.items.clear();
  keychain.failing = false;
  rawPost.mockReset();
  rawGet.mockReset();
  apiPost.mockReset();
  localStorage.clear();
});

describe('in the native app', () => {
  it('keeps the refresh token a new guest is given, in the keychain', async () => {
    const store = await loadStore(true);
    rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: guest } });
    await store.getState().loginAsGuest();
    expect(keychain.items.get(KEY)).toBe('refresh-1');
    expect(store.getState()).toMatchObject({ isAuthenticated: true, accessToken: 'access-1' });
    // The persisted slice is still only who the player is: no token of either kind.
    expect(localStorage.getItem('cc-auth')).not.toContain('refresh-1');
    expect(localStorage.getItem('cc-auth')).not.toContain('access-1');
  });

  it('keeps the token from sign-in, register, upgrade and an emailed link the same way', async () => {
    const store = await loadStore(true);
    const answer = (n: number) => ({ data: { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, user: guest } });
    apiPost.mockResolvedValueOnce(answer(1));
    await store.getState().login('a@b.c', 'pw');
    expect(keychain.items.get(KEY)).toBe('refresh-1');
    apiPost.mockResolvedValueOnce(answer(2));
    await store.getState().register('Name', 'a@b.c', 'pw');
    expect(keychain.items.get(KEY)).toBe('refresh-2');
    apiPost.mockResolvedValueOnce(answer(3));
    await store.getState().upgradeAccount('Name', 'a@b.c', 'pw');
    expect(keychain.items.get(KEY)).toBe('refresh-3');
    apiPost.mockResolvedValueOnce(answer(4));
    await store.getState().signInWithLink('link-token');
    expect(keychain.items.get(KEY)).toBe('refresh-4');
  });

  it('renews with the keychain token in the body, and stores the one it gets back', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
    expect(await store.getState().refreshToken()).toBe('ok');
    expect(rawPost).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-1' });
    expect(keychain.items.get(KEY)).toBe('refresh-2');
    expect(store.getState().accessToken).toBe('access-2');
  });

  it('is signed out, and forgets the token, when the server ends the app\'s session', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockRejectedValueOnce(httpError(401, { error: 'Refresh token invalid or revoked', native: true }));
    expect(await store.getState().refreshToken()).toBe('invalid');
    expect(store.getState().isAuthenticated).toBe(false);
    await vi.waitFor(() => expect(keychain.items.has(KEY)).toBe(false));
  });

  // A server run without NATIVE_APP_ORIGINS looks for a cookie, finds none,
  // and answers 401. The token is fine; deleting it would sign out every
  // player for good, and a guest's account with it.
  it('keeps its session and its token when a 401 does not come from the app\'s own path', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockRejectedValueOnce(httpError(401, { error: 'No refresh token' }));
    expect(await store.getState().refreshToken()).toBe('unreachable');
    expect(store.getState().isAuthenticated).toBe(true);
    expect(keychain.items.get(KEY)).toBe('refresh-1');
  });

  it('keeps its session through an "update required" and through an unreachable server', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockRejectedValueOnce(httpError(426, { code: 'UPDATE_REQUIRED' }));
    expect(await store.getState().refreshToken()).toBe('unreachable');
    rawPost.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(await store.getState().refreshToken()).toBe('unreachable');
    expect(store.getState().isAuthenticated).toBe(true);
    expect(keychain.items.get(KEY)).toBe('refresh-1');
  });

  it('is signed out with no request when it holds no token at all', async () => {
    const store = await loadStore(true);
    store.setState({ user: guest as never, isAuthenticated: true });
    expect(await store.getState().refreshToken()).toBe('invalid');
    expect(rawPost).not.toHaveBeenCalled();
    expect(store.getState().isAuthenticated).toBe(false);
  });

  it('stays signed in when the keychain cannot be read just now', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    keychain.failing = true;
    store.setState({ user: guest as never, isAuthenticated: true });
    expect(await store.getState().refreshToken()).toBe('unreachable');
    expect(rawPost).not.toHaveBeenCalled();
    expect(store.getState().isAuthenticated).toBe(true);
    expect(keychain.items.get(KEY)).toBe('refresh-1');
  });

  it('signs out by naming its token to the server, then forgets it', async () => {
    const store = await loadStore(true);
    keychain.items.set(KEY, 'refresh-1');
    store.setState({ user: guest as never, isAuthenticated: true, accessToken: 'access-1' });
    apiPost.mockResolvedValueOnce({ data: {} });
    await store.getState().logout();
    expect(apiPost).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh-1' });
    await vi.waitFor(() => expect(keychain.items.has(KEY)).toBe(false));
    expect(store.getState().isAuthenticated).toBe(false);
  });

  describe('after a reinstall, when the web view remembers nobody', () => {
    it('signs the player back in from the keychain: the only way back for a guest', async () => {
      const store = await loadStore(true);
      keychain.items.set(KEY, 'refresh-1');
      rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
      rawGet.mockResolvedValueOnce({ data: guest });
      expect(await store.getState().recoverNativeSession()).toBe(true);
      expect(rawPost).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-1' });
      expect(rawGet).toHaveBeenCalledWith('/users/me', { headers: { Authorization: 'Bearer access-2' } });
      expect(store.getState()).toMatchObject({ isAuthenticated: true, accessToken: 'access-2', user: guest });
      expect(keychain.items.get(KEY)).toBe('refresh-2');
    });

    it('does nothing when the keychain is empty', async () => {
      const store = await loadStore(true);
      expect(await store.getState().recoverNativeSession()).toBe(false);
      expect(rawPost).not.toHaveBeenCalled();
      expect(store.getState().isAuthenticated).toBe(false);
    });

    it('forgets a token the server has ended, and leaves the player signed out', async () => {
      const store = await loadStore(true);
      keychain.items.set(KEY, 'refresh-1');
      rawPost.mockRejectedValueOnce(httpError(401, { error: 'User not found', native: true }));
      expect(await store.getState().recoverNativeSession()).toBe(false);
      expect(keychain.items.has(KEY)).toBe(false);
      expect(store.getState().isAuthenticated).toBe(false);
    });

    it('keeps the new token when only the profile request failed, to try again next launch', async () => {
      const store = await loadStore(true);
      keychain.items.set(KEY, 'refresh-1');
      rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
      rawGet.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));
      expect(await store.getState().recoverNativeSession()).toBe(false);
      expect(keychain.items.get(KEY)).toBe('refresh-2');
      expect(store.getState().isAuthenticated).toBe(false);
    });

    it('leaves a session that is already there alone', async () => {
      const store = await loadStore(true);
      keychain.items.set(KEY, 'refresh-1');
      store.setState({ user: guest as never, isAuthenticated: true });
      expect(await store.getState().recoverNativeSession()).toBe(false);
      expect(rawPost).not.toHaveBeenCalled();
    });
  });
});

describe('on the website, nothing changes', () => {
  it('renews with the cookie alone: no body, and nothing stored', async () => {
    const store = await loadStore(false);
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-2' } });
    expect(await store.getState().refreshToken()).toBe('ok');
    expect(rawPost).toHaveBeenCalledWith('/auth/refresh');
    expect(keychain.items.size).toBe(0);
  });

  it('is signed out by any 401 or 403 on refresh, as before', async () => {
    const store = await loadStore(false);
    store.setState({ user: guest as never, isAuthenticated: true });
    rawPost.mockRejectedValueOnce(httpError(401, { error: 'No refresh token' }));
    expect(await store.getState().refreshToken()).toBe('invalid');
    expect(store.getState().isAuthenticated).toBe(false);
  });

  it('never stores a token, even if a response were to carry one', async () => {
    const store = await loadStore(false);
    rawPost.mockResolvedValueOnce({ data: { accessToken: 'access-1', refreshToken: 'should-not-happen', user: guest } });
    await store.getState().loginAsGuest();
    expect(keychain.items.size).toBe(0);
    expect(JSON.stringify({ ...localStorage })).not.toContain('should-not-happen');
  });

  it('signs out with the cookie: no body', async () => {
    const store = await loadStore(false);
    store.setState({ user: guest as never, isAuthenticated: true });
    apiPost.mockResolvedValueOnce({ data: {} });
    await store.getState().logout();
    expect(apiPost).toHaveBeenCalledWith('/auth/logout');
  });

  it('has no session to recover', async () => {
    const store = await loadStore(false);
    keychain.items.set(KEY, 'refresh-1');
    expect(await store.getState().recoverNativeSession()).toBe(false);
    expect(rawPost).not.toHaveBeenCalled();
  });
});

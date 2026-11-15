/**
 * The native app keeps its refresh token in the device keychain. The website
 * keeps nothing here: its session is an httpOnly cookie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const native = vi.hoisted(() => ({ on: false, pluginInBuild: true }));
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
const keychain = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failing: false,
  hanging: false,
  sets: [] as unknown[][],
}));
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { afterFirstUnlockThisDeviceOnly: 3 },
  SecureStorage: {
    get: async (key: string) => {
      if (keychain.hanging) return new Promise(() => {});
      if (keychain.failing) throw new Error('keychain locked');
      return keychain.items.get(key) ?? null;
    },
    set: async (...args: unknown[]) => {
      if (keychain.failing) throw new Error('keychain locked');
      keychain.sets.push(args);
      keychain.items.set(args[0] as string, args[1] as string);
    },
    remove: async (key: string) => {
      if (keychain.failing) throw new Error('keychain locked');
      return keychain.items.delete(key);
    },
  },
}));

import {
  clearNativeRefreshToken,
  isNativeSessionRefusal,
  keepNativeSessionFrom,
  loadNativeRefreshToken,
  nativeKeychainAvailable,
  readNativeRefreshToken,
  resetNativeSessionForTests,
  saveNativeRefreshToken,
  usesNativeSession,
} from './nativeSession';

beforeEach(() => {
  native.on = false;
  keychain.items.clear();
  keychain.failing = false;
  keychain.sets = [];
  resetNativeSessionForTests();
});

describe('on the website', () => {
  it('stores nothing, reads nothing and never touches the keychain', async () => {
    expect(usesNativeSession()).toBe(false);
    await saveNativeRefreshToken('token-a');
    await keepNativeSessionFrom({ refreshToken: 'token-b' });
    expect(keychain.sets).toEqual([]);
    expect(await loadNativeRefreshToken()).toBeNull();
    expect(await readNativeRefreshToken()).toEqual({ status: 'none' });
    await clearNativeRefreshToken();
    expect(localStorage.length).toBe(0);
  });
});

describe('in the native app', () => {
  beforeEach(() => {
    native.on = true;
  });

  it('keeps the token in the keychain, on this device only, and reads it back', async () => {
    await saveNativeRefreshToken('token-a');
    // key, value, convertDate, iCloud sync off, access class.
    expect(keychain.sets).toEqual([['bf-refresh-token', 'token-a', false, false, 3]]);
    resetNativeSessionForTests();
    expect(await readNativeRefreshToken()).toEqual({ status: 'held', token: 'token-a' });
    expect(await loadNativeRefreshToken()).toBe('token-a');
    // Never in web storage, where any script on the page could read it.
    expect(JSON.stringify({ ...localStorage })).not.toContain('token-a');
  });

  it('keeps the token a sign-in or refresh response carries, and ignores a response without one', async () => {
    await keepNativeSessionFrom({ accessToken: 'a', refreshToken: 'token-b' });
    expect(await loadNativeRefreshToken()).toBe('token-b');
    await keepNativeSessionFrom({ accessToken: 'a' });
    await keepNativeSessionFrom(null);
    await keepNativeSessionFrom({ refreshToken: 7 });
    expect(await loadNativeRefreshToken()).toBe('token-b');
  });

  it('reports nothing held after it is cleared', async () => {
    await saveNativeRefreshToken('token-a');
    await clearNativeRefreshToken();
    expect(keychain.items.size).toBe(0);
    expect(await readNativeRefreshToken()).toEqual({ status: 'none' });
  });

  // An unreadable keychain may well hold a token. Taking that for "signed
  // out" would lead the caller to delete it.
  it('says "unreadable", not "none", when the keychain cannot be read, and tries again next time', async () => {
    keychain.items.set('bf-refresh-token', 'token-a');
    keychain.failing = true;
    expect(await readNativeRefreshToken()).toEqual({ status: 'unreadable' });
    expect(await loadNativeRefreshToken()).toBeNull();
    keychain.failing = false;
    expect(await readNativeRefreshToken()).toEqual({ status: 'held', token: 'token-a' });
  });

  // Without its native half the plugin's iOS code calls itself forever and
  // freezes the app at launch. The build is checked first.
  it('never calls a plugin whose native code is missing from the build', async () => {
    native.pluginInBuild = false;
    try {
      keychain.items.set('bf-refresh-token', 'token-a');
      expect(nativeKeychainAvailable()).toBe(false);
      expect(await readNativeRefreshToken()).toEqual({ status: 'unreadable' });
      await saveNativeRefreshToken('token-b');
      await clearNativeRefreshToken();
      expect(keychain.sets).toEqual([]);
      expect(keychain.items.get('bf-refresh-token')).toBe('token-a');
    } finally {
      native.pluginInBuild = true;
    }
    expect(nativeKeychainAvailable()).toBe(true);
  });

  // The app's first screen waits on this read. A native call that never
  // answers has to fail, not hold the app on a blank screen.
  it('gives up on a keychain that never answers, and calls it unreadable', async () => {
    vi.useFakeTimers();
    try {
      keychain.hanging = true;
      const read = readNativeRefreshToken();
      await vi.advanceTimersByTimeAsync(3100);
      expect(await read).toEqual({ status: 'unreadable' });
    } finally {
      keychain.hanging = false;
      vi.useRealTimers();
    }
  });

  it('holds a new token in memory for this run when the keychain refuses to store it', async () => {
    keychain.failing = true;
    await expect(saveNativeRefreshToken('token-c')).resolves.toBeUndefined();
    expect(await loadNativeRefreshToken()).toBe('token-c');
  });
});

describe('isNativeSessionRefusal', () => {
  it('is a 401 or 403 the server marked as the app\'s', () => {
    expect(isNativeSessionRefusal(401, { error: 'Refresh token invalid or revoked', native: true })).toBe(true);
    expect(isNativeSessionRefusal(403, { error: 'Account is banned', native: true })).toBe(true);
  });

  it('is not an unmarked 401 (a server without NATIVE_APP_ORIGINS), nor any other failure', () => {
    expect(isNativeSessionRefusal(401, { error: 'No refresh token' })).toBe(false);
    expect(isNativeSessionRefusal(401, undefined)).toBe(false);
    expect(isNativeSessionRefusal(426, { code: 'UPDATE_REQUIRED', native: true })).toBe(false);
    expect(isNativeSessionRefusal(500, { native: true })).toBe(false);
    expect(isNativeSessionRefusal(undefined, { native: true })).toBe(false);
  });
});

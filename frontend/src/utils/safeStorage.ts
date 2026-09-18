/**
 * Web Storage that cannot throw.
 *
 * A cross-site iframe — the itch.io and CrazyGames embeds — does not merely get
 * a *partitioned* Web Storage when the browser blocks third-party storage: it
 * gets none at all. Every access, `window.localStorage` included, throws
 * `SecurityError: Access is denied for this document`. Safari does this by
 * default; Chrome does it whenever "Block third-party cookies" is on.
 *
 * Measured in the real itch framing chain (Chromium, third-party cookies
 * blocked, top-level `https://itch.io`), that denial rendered the embed as a
 * blank screen: zustand's `persist` silently drops its `store.persist` API when
 * its storage backend is unavailable, and `useAuthStoreHydrated` then
 * dereferenced `undefined` and took the React tree down before first paint.
 *
 * So storage access goes through here. When Web Storage is denied the fallback
 * is per-tab memory: nothing survives a reload there — a browser that denies
 * storage denies the refresh cookie too, so the session cannot be recovered
 * either way — but the game stays playable instead of rendering nothing.
 *
 * The probe WRITES, because "access did not throw" is not the same as "usable":
 * Safari's private mode has historically handed out a `localStorage` with a
 * zero quota, which throws only once you call `setItem`.
 */

/** The slice of `Storage` this app actually uses. */
export type SafeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PROBE_KEY = '__bf_storage_probe__';

function createMemoryStorage(): SafeStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function probeWebStorage(kind: 'localStorage' | 'sessionStorage'): SafeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window[kind];
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}

// Memoised so the memory fallback is one shared map for the tab's lifetime
// rather than a fresh empty one per call.
let localCache: SafeStorage | undefined;
let sessionCache: SafeStorage | undefined;

/** `localStorage` when the document has one, otherwise per-tab memory. */
export function safeLocalStorage(): SafeStorage {
  localCache ??= probeWebStorage('localStorage') ?? createMemoryStorage();
  return localCache;
}

/** `sessionStorage` when the document has one, otherwise per-tab memory. */
export function safeSessionStorage(): SafeStorage {
  sessionCache ??= probeWebStorage('sessionStorage') ?? createMemoryStorage();
  return sessionCache;
}

/** Test-only: drop the memoised probes so the next call re-probes. */
export function resetSafeStorageForTests(): void {
  localCache = undefined;
  sessionCache = undefined;
}

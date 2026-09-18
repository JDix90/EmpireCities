import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({
  resyncSocketAuth: vi.fn(),
  disconnectSocket: vi.fn(),
}));

/**
 * Regression cover for the itch/CrazyGames embed going blank.
 *
 * A cross-site iframe whose browser blocks third-party storage gets no Web
 * Storage at all — every access throws — and zustand's `persist` responds by
 * dropping its whole `store.persist` API. `useAuthStoreHydrated` dereferenced
 * that and took the React tree down before first paint: `#root` stayed empty
 * and the embed showed nothing at all.
 */
function thrower(): never {
  throw new DOMException('Access is denied for this document.', 'SecurityError');
}

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function denyLocalStorage(): void {
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: thrower });
    return;
  } catch {
    // Non-configurable in the shared test setup — see safeStorage.test.ts.
  }
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: thrower, setItem: thrower, removeItem: thrower,
    clear: thrower, key: thrower, length: 0,
  } as unknown as Storage;
}

describe('authStore persistence', () => {
  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    vi.resetModules();
  });

  it('keeps its persist API when Web Storage is denied', async () => {
    denyLocalStorage();
    vi.resetModules();
    const { useAuthStore } = await import('./authStore');

    // The crash was `undefined.hasHydrated()`.
    expect(useAuthStore.persist).toBeDefined();
    expect(typeof useAuthStore.persist.hasHydrated).toBe('function');
    expect(() => useAuthStore.persist.hasHydrated()).not.toThrow();

    // And the store is still usable — the session just lives in memory.
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    useAuthStore.setState({ isAuthenticated: true });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('rehydrates a slice in the format the previous backend wrote', async () => {
    // Guards the deploy: swapping the persist backend must not invalidate
    // sessions already sitting in players' browsers.
    window.localStorage.setItem('cc-auth', JSON.stringify({
      state: { user: { id: 'u1', username: 'Guest_abc12345' }, isAuthenticated: true },
      version: 0,
    }));
    vi.resetModules();
    const { useAuthStore } = await import('./authStore');

    expect(useAuthStore.getState().user?.username).toBe('Guest_abc12345');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    window.localStorage.removeItem('cc-auth');
  });
});

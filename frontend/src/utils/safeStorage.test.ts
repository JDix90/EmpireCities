import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { safeLocalStorage, resetSafeStorageForTests } from './safeStorage';

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function thrower(): never {
  throw new DOMException('Access is denied for this document.', 'SecurityError');
}

/** Replace `localStorage` with one that fails the way a blocked iframe's does. */
function denyLocalStorage(shape: 'access' | 'write'): void {
  const denied = shape === 'write'
    // Safari's private mode: access and reads work, the quota is zero.
    ? { getItem: () => null, setItem: thrower, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 }
    : { getItem: thrower, setItem: thrower, removeItem: thrower, clear: thrower, key: thrower, length: 0 };
  if (shape === 'access') {
    try {
      // Faithful to the browser: the property access itself throws, before any
      // method is called.
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: thrower });
      return;
    } catch {
      // The shared test setup installs a non-configurable `localStorage`, so
      // the accessor swap is rejected. Falling back to an object whose every
      // method throws moves the failure one step later and exercises the same
      // guard.
    }
  }
  (globalThis as unknown as { localStorage: Storage }).localStorage = denied as unknown as Storage;
}

describe('safeStorage', () => {
  beforeEach(() => resetSafeStorageForTests());

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    resetSafeStorageForTests();
  });

  it('uses real Web Storage when the document has it', () => {
    safeLocalStorage().setItem('cc-probe-real', 'kept');
    expect(window.localStorage.getItem('cc-probe-real')).toBe('kept');
    safeLocalStorage().removeItem('cc-probe-real');
    expect(safeLocalStorage().getItem('cc-probe-real')).toBeNull();
  });

  it('falls back to memory when Web Storage access is denied', () => {
    denyLocalStorage('access');
    const storage = safeLocalStorage();
    expect(() => storage.setItem('cc-probe-denied', 'in-memory')).not.toThrow();
    expect(storage.getItem('cc-probe-denied')).toBe('in-memory');
  });

  it('falls back to memory when the quota is zero and only writes throw', () => {
    // The docstring's Safari-private-mode case: `localStorage` is handed out
    // and reads fine, so a probe that only checked for a thrown property
    // access would wrongly report it usable.
    denyLocalStorage('write');
    const storage = safeLocalStorage();
    expect(() => storage.setItem('cc-probe-quota', 'in-memory')).not.toThrow();
    expect(storage.getItem('cc-probe-quota')).toBe('in-memory');
  });

  it('shares one memory fallback across calls', () => {
    denyLocalStorage('access');
    safeLocalStorage().setItem('cc-probe-shared', 'first');
    // A fresh call must not hand back an empty map.
    expect(safeLocalStorage().getItem('cc-probe-shared')).toBe('first');
  });

  it('returns null rather than undefined for a missing key', () => {
    denyLocalStorage('access');
    expect(safeLocalStorage().getItem('cc-probe-absent')).toBeNull();
  });

});

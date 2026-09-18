import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAnonSessionId } from './anonSession';
import { resetSafeStorageForTests } from './safeStorage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

describe('getAnonSessionId', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSafeStorageForTests();
  });

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    resetSafeStorageForTests();
  });

  it('mints a UUID on first call and persists it', () => {
    const id = getAnonSessionId();
    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem('cc-anon-session')).toBe(id);
  });

  it('is stable across calls', () => {
    expect(getAnonSessionId()).toBe(getAnonSessionId());
  });

  it('replaces a tampered/malformed stored value instead of returning it', () => {
    localStorage.setItem('cc-anon-session', '<script>alert(1)</script>');
    const id = getAnonSessionId();
    expect(id).toMatch(UUID_RE);
    expect(localStorage.getItem('cc-anon-session')).toBe(id);
  });

  it('still mints an id when the document has no Web Storage', () => {
    // The portal case: a cross-site iframe in Safari, or Chrome with
    // third-party cookies blocked, cannot touch localStorage at all. This
    // returned null there, so those players emitted no funnel events.
    const thrower = (): never => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    };
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: thrower, setItem: thrower, removeItem: thrower,
      clear: thrower, key: thrower, length: 0,
    } as unknown as Storage;
    resetSafeStorageForTests();

    const id = getAnonSessionId();
    expect(id).not.toBeNull(); // null here means the funnel event is dropped
    expect(id).toMatch(UUID_RE);
    // Stable for the tab, which is all the landing-view → signup stitch needs.
    expect(getAnonSessionId()).toBe(id);
  });
});

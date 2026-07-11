import { describe, it, expect, beforeEach } from 'vitest';
import { getAnonSessionId } from './anonSession';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('getAnonSessionId', () => {
  beforeEach(() => {
    localStorage.clear();
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
});

import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, sanitizePostAuthRedirect } from './navRedirect';

describe('isSafeInternalPath', () => {
  it('accepts paths on this site', () => {
    for (const p of ['/', '/lobby', '/game/abc-123', '/profile?tab=stats#top', '/a%5Cb']) {
      expect(isSafeInternalPath(p)).toBe(true);
    }
  });

  it('refuses anything that is not a single-slash path, or holds a backslash or control character', () => {
    for (const p of ['', 'lobby', 'https://example.com', '//example.com', '/\\example.com', '/a\\b', '/\t/example.com', '/\n/x', '/x\u007f']) {
      expect(isSafeInternalPath(p)).toBe(false);
    }
  });
});

describe('sanitizePostAuthRedirect', () => {
  it('keeps a safe path, trimmed', () => {
    expect(sanitizePostAuthRedirect('  /game/g1 ')).toBe('/game/g1');
  });

  it('falls back to the lobby otherwise', () => {
    for (const raw of [null, '', 'https://example.com', '//example.com', '/\\example.com']) {
      expect(sanitizePostAuthRedirect(raw)).toBe('/lobby');
    }
  });
});

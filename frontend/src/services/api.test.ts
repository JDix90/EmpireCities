import { describe, it, expect } from 'vitest';
import { busyMessageFor } from './api';

describe('busyMessageFor', () => {
  it('uses the server-provided message when present (the 429/503 body uses `message`)', () => {
    expect(busyMessageFor(429, 'Too many authentication attempts. Please wait and try again.')).toBe(
      'Too many authentication attempts. Please wait and try again.',
    );
  });

  it('falls back to a retryable 429 message when the body has none', () => {
    expect(busyMessageFor(429)).toMatch(/too many requests/i);
  });

  it('falls back to a "busy, try again" message for 503', () => {
    expect(busyMessageFor(503)).toMatch(/busy/i);
  });
});

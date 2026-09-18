import { describe, it, expect } from 'vitest';
import { api, busyMessageFor } from './api';
import { REQUEST_TIMEOUT_MS } from '../config/env';

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

describe('REQUEST_TIMEOUT_MS', () => {
  it('is applied to the api instance', () => {
    // `rawHttp` in authStore reads the same constant, so the two instances
    // cannot drift apart. An untimed auth refresh hangs `bootstrapped`
    // forever, which parks every caller of waitForAuthBootstrap.
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
  });

  it('is long enough not to trip a slow-but-working connection', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
  });
});

/**
 * GIF search in chat is offered on the website when a Tenor key is configured,
 * and never in the native app, which ships with chat but without GIF search.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? 'ios' : 'web') },
}));

async function load(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv('VITE_TENOR_API_KEY', '');
  else vi.stubEnv('VITE_TENOR_API_KEY', key);
  return import('./gifSearch');
}

afterEach(() => {
  native.on = false;
  vi.unstubAllEnvs();
});

describe('isGifSearchAvailable', () => {
  it('is on for the website when a Tenor key is configured', async () => {
    expect((await load('tenor-key')).isGifSearchAvailable()).toBe(true);
  });

  it('is off without a key', async () => {
    expect((await load(undefined)).isGifSearchAvailable()).toBe(false);
  });

  it('is off in the native app even with a key', async () => {
    native.on = true;
    expect((await load('tenor-key')).isGifSearchAvailable()).toBe(false);
  });
});

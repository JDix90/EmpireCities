/**
 * A tab opened before a deploy asks for the previous build's chunks, which the
 * deploy deleted ("Failed to fetch dynamically imported module" in Sentry, on
 * deploy days). The lazy loads retry and then reload onto the new build, at
 * most once a minute, so a tab left open across two deploys recovers from the
 * second as well as the first, and a broken deploy cannot reload forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Suspense } from 'react';
import { CHUNK_RELOAD_COOLDOWN_MS, isChunkLoadError, lazyWithChunkRetry, reloadForNewBuild } from './lazyWithChunkRetry';

const stale = () => new TypeError('Failed to fetch dynamically imported module: https://borderfall.gg/assets/GlobeMap-abc123.js');

describe('recovering from a deploy that replaced this tab\'s chunks', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    reload.mockReset();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('recognises the error Sentry reported', () => {
    expect(isChunkLoadError(stale())).toBe(true);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
  });

  it('reloads at most once a minute, so a second deploy later in the session still recovers', () => {
    const t0 = 1_000_000;
    expect(reloadForNewBuild(t0)).toBe(true);
    expect(reloadForNewBuild(t0 + 5_000)).toBe(false); // a broken deploy: no loop
    expect(reloadForNewBuild(t0 + CHUNK_RELOAD_COOLDOWN_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('treats the old once-a-session marker as long ago', () => {
    sessionStorage.setItem('ec_chunk_reloaded', '1');
    expect(reloadForNewBuild()).toBe(true);
  });

  it('retries a lazy component once, then reloads, when its chunk is gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const factory = vi.fn(() => Promise.reject(stale()));
      const Gone = lazyWithChunkRetry(factory);
      render(<Suspense fallback={<p>loading</p>}><Gone /></Suspense>);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(factory).toHaveBeenCalledTimes(2);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.getByText('loading')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes components that have props, as the globe does', async () => {
    const Labelled = lazyWithChunkRetry(async () => ({ default: ({ label }: { label: string }) => <p>{label}</p> }));
    render(<Suspense fallback={null}><Labelled label="globe ready" /></Suspense>);
    expect(await screen.findByText('globe ready')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

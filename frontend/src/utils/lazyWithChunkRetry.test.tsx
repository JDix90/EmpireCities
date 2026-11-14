/**
 * A tab opened before a deploy asks for the previous build's chunks, which the
 * deploy deleted ("Failed to fetch dynamically imported module" in Sentry, on
 * deploy days). The lazy loads retry and then reload onto the new build, at
 * most once a minute, so a tab left open across two deploys recovers from the
 * second as well as the first, and a broken deploy cannot reload forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  isChunkLoadError,
  lazyWithChunkRetry,
  reloadForNewBuild,
  reloadingForNewBuild,
  resetChunkReloadStateForTests,
} from './lazyWithChunkRetry';

const stale = () => new TypeError('Failed to fetch dynamically imported module: https://borderfall.gg/assets/GlobeMap-abc123.js');

describe('recovering from a deploy that replaced this tab\'s chunks', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    reload.mockReset();
    sessionStorage.clear();
    resetChunkReloadStateForTests();
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

  describe('while the page reloads onto the new build', () => {
    /** Whatever React would have shown as the error screen. */
    class Caught extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) { return { error }; }
      render() { return this.state.error ? <p>crashed: {this.state.error.message}</p> : this.props.children; }
    }
    const mount = (node: ReactNode) => render(<Caught><Suspense fallback={<p>loading</p>}>{node}</Suspense></Caught>);
    // Vite's preload helper, its vite:preloadError cancelled by main.tsx, resolves the import to undefined.
    const emptyImport = () => Promise.resolve(undefined as unknown as { default: () => null });

    it('waits for the reload when Vite hands back an empty module, instead of crashing on .default', async () => {
      expect(reloadForNewBuild()).toBe(true);
      expect(reloadingForNewBuild()).toBe(true);
      const Page = lazyWithChunkRetry(emptyImport);
      mount(<Page />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('loading')).toBeInTheDocument();
      expect(screen.queryByText(/crashed/)).toBeNull();
    });

    it('waits too when a named-export factory trips over the empty module', async () => {
      reloadForNewBuild();
      // As App.tsx's Daily archive index: reading `.DailyArchiveIndexPage` off
      // nothing is a TypeError, not a chunk error.
      const Index = lazyWithChunkRetry(() =>
        emptyImport().then((m) => ({ default: (m as unknown as { DailyArchiveIndexPage: () => null }).DailyArchiveIndexPage })));
      mount(<Index />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('loading')).toBeInTheDocument();
      expect(screen.queryByText(/crashed/)).toBeNull();
    });

    it('does not retry a missing chunk once another load has started the reload', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        reloadForNewBuild();
        const factory = vi.fn(() => Promise.reject(stale()));
        const Gone = lazyWithChunkRetry(factory);
        mount(<Gone />);
        await act(async () => { await vi.advanceTimersByTimeAsync(600); });
        // The page is already leaving: no retry, no second reload, no error.
        expect(factory).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(screen.getByText('loading')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('still reports an empty module when no reload is under way: that is a real bug', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const Broken = lazyWithChunkRetry(emptyImport);
        mount(<Broken />);
        expect(await screen.findByText(/crashed/)).toBeInTheDocument();
        expect(reload).not.toHaveBeenCalled();
      } finally {
        quiet.mockRestore();
      }
    });
  });
});

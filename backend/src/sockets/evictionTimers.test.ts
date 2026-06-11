import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { armEvictionTimer, cancelEvictionTimer, pendingEvictionCount } from './evictionTimers';

describe('evictionTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // Drain anything left so tests can't leak timers into each other.
    cancelEvictionTimer('g1');
    cancelEvictionTimer('g2');
    vi.useRealTimers();
  });

  it('fires after the delay and removes itself from the registry', () => {
    const fn = vi.fn();
    armEvictionTimer('g1', 1000, fn);
    expect(pendingEvictionCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pendingEvictionCount()).toBe(0);
  });

  it('cancel prevents the eviction — the rejoin case', () => {
    const fn = vi.fn();
    armEvictionTimer('g1', 1000, fn);
    expect(cancelEvictionTimer('g1')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
    expect(pendingEvictionCount()).toBe(0);
  });

  it('re-arming replaces the previous timer instead of stacking', () => {
    const first = vi.fn();
    const second = vi.fn();
    armEvictionTimer('g1', 1000, first);
    armEvictionTimer('g1', 1000, second);
    expect(pendingEvictionCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel returns false when nothing is pending', () => {
    expect(cancelEvictionTimer('g2')).toBe(false);
  });

  it('tracks games independently', () => {
    const a = vi.fn();
    const b = vi.fn();
    armEvictionTimer('g1', 1000, a);
    armEvictionTimer('g2', 1000, b);
    cancelEvictionTimer('g1');
    vi.advanceTimersByTime(1000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

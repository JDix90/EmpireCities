/**
 * The boot sweeps' first runs: after the deploy has had its minutes, one at a
 * time, and never the instant the backend starts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: vi.fn(),
  pgPool: {},
}));
vi.mock('./singletonTask', () => ({
  SWEEP_LOCK_TTL_MS: 60_000,
  runExclusive: (_name: string, _ttl: number, fn: () => Promise<void>) => fn(),
}));

import { BOOT_SWEEP_DELAY_MS, BOOT_SWEEP_STAGGER_MS, BOOT_SWEEPS, bootSweepDelayMs, scheduleBootSweep } from './bootSweep';
import { startOrphanedGameSweep, stopOrphanedGameSweep } from '../modules/games/gameCleanupService';
import { startGuestCleanupSweep, stopGuestCleanupSweep } from '../modules/users/guestCleanupService';

describe('the boot sweeps', () => {
  it('wait two minutes, then go one at a time, thirty seconds apart, the orphaned-game sweep last', () => {
    expect(BOOT_SWEEP_DELAY_MS).toBe(120_000);
    expect(BOOT_SWEEP_STAGGER_MS).toBe(30_000);
    expect(BOOT_SWEEPS.map(bootSweepDelayMs)).toEqual([120_000, 150_000, 180_000, 210_000, 240_000]);
    expect(BOOT_SWEEPS[BOOT_SWEEPS.length - 1]).toBe('orphaned-games');
  });
});

describe('scheduleBootSweep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once, at its time after boot', () => {
    const run = vi.fn();
    scheduleBootSweep('season', run);
    vi.advanceTimersByTime(bootSweepDelayMs('season') - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing once cancelled', () => {
    const run = vi.fn();
    const cancel = scheduleBootSweep('orphaned-games', run);
    cancel();
    vi.advanceTimersByTime(bootSweepDelayMs('orphaned-games'));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('sweeps that used to query the instant the backend booted', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
  });
  afterEach(() => {
    stopOrphanedGameSweep();
    stopGuestCleanupSweep();
    vi.useRealTimers();
  });

  it('the orphaned-game sweep first touches the database at its time after boot', async () => {
    startOrphanedGameSweep();
    await vi.advanceTimersByTimeAsync(bootSweepDelayMs('orphaned-games') - 1);
    expect(queryMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queryMock).toHaveBeenCalled();
    expect(String(queryMock.mock.calls[0]![0])).toContain('DELETE FROM games');
  });

  it('the guest cleanup first touches the database at its time after boot', async () => {
    startGuestCleanupSweep();
    await vi.advanceTimersByTimeAsync(bootSweepDelayMs('guest-cleanup') - 1);
    expect(queryMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('a shutdown before then runs neither', async () => {
    startOrphanedGameSweep();
    startGuestCleanupSweep();
    stopOrphanedGameSweep();
    stopGuestCleanupSweep();
    await vi.advanceTimersByTimeAsync(bootSweepDelayMs('orphaned-games'));
    expect(queryMock).not.toHaveBeenCalled();
  });
});

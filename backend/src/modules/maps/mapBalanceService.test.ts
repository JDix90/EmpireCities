import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('../../db/redis', () => ({
  getRedis: () => ({
    get: async (k: string) => store.get(k) ?? null,
    setex: async (k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return 'OK';
    },
  }),
}));

import type { GameMap } from '../../types';
import type { BalanceSimReport } from './mapBalanceSim';
import { BalanceBusyError, balanceCacheKey, balanceGameCount, getBalanceReport, resetBalanceRuns, resolveBalanceOptions } from './mapBalanceService';

const map = {
  map_id: 'm1',
  territories: [{ territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' }],
  connections: [],
  regions: [{ region_id: 'r', name: 'R', bonus: 1 }],
} as unknown as GameMap;

const report = (gamesPlayed: number): BalanceSimReport => ({
  gamesPlayed, gamesRequested: gamesPlayed, seats: 4, maxRounds: 40, difficulty: 'medium', era: 'modern',
  seatWins: [1, 1, 1, 1], firstMoverWins: 1, unfinished: 0, rounds: { mean: 20, min: 10, max: 30 }, endings: {},
  regions: [], neverCaptured: [], firstEliminationRound: null, durationMs: 5,
});

beforeEach(() => {
  store.clear();
  resetBalanceRuns();
});

describe('resolveBalanceOptions', () => {
  it('clamps what the request may choose and fixes the rest', () => {
    const o = resolveBalanceOptions('m1', { games: 99, seats: 1, difficulty: 'hard', maxRounds: 3 });
    expect(o).toMatchObject({ games: 36, seats: 2, difficulty: 'hard', maxRounds: 10, era: 'modern', seed: 'balance:m1' });
    expect(resolveBalanceOptions('m1', { difficulty: 'expert' as never }).difficulty).toBe('medium');
  });

  it('plays about twenty games by default, never fewer than five first moves per seat', () => {
    expect([2, 3, 4, 5, 6].map((seats) => resolveBalanceOptions('m1', { seats }).games)).toEqual([20, 21, 20, 25, 30]);
  });
});

describe('balanceGameCount', () => {
  it('rounds a requested count to whole rotations of the first move', () => {
    expect(balanceGameCount(4, 9)).toBe(8);
    expect(balanceGameCount(4, 10)).toBe(12);
    expect(balanceGameCount(3, 21)).toBe(21);
  });

  it('plays at least one rotation and at most the cap, kept a multiple of the seats', () => {
    expect(balanceGameCount(6, 1)).toBe(6);
    expect(balanceGameCount(4, 99)).toBe(36);
    expect(balanceGameCount(5, 99)).toBe(35);
    expect(balanceGameCount(6, 99)).toBe(36);
  });
});

describe('getBalanceReport', () => {
  it('plays once, caches by content and options, and serves the cache after', async () => {
    const simulate = vi.fn(async () => report(8));
    const options = resolveBalanceOptions('m1', {});
    const first = await getBalanceReport(map, options, simulate);
    const second = await getBalanceReport(map, options, simulate);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(simulate).toHaveBeenCalledTimes(1);
    // A changed board is a new report.
    const moved = { ...map, connections: [{ from: 'a', to: 'a', type: 'land' }] } as unknown as GameMap;
    expect(balanceCacheKey(moved, options)).not.toBe(balanceCacheKey(map, options));
  });

  it('shares a run in progress and refuses a second different one meanwhile', async () => {
    let release: (r: BalanceSimReport) => void = () => {};
    const simulate = vi.fn(() => new Promise<BalanceSimReport>((resolve) => { release = resolve; }));
    const options = resolveBalanceOptions('m1', {});
    const a = getBalanceReport(map, options, simulate);
    const b = getBalanceReport(map, options, simulate);
    await Promise.resolve();
    await expect(getBalanceReport(map, resolveBalanceOptions('m1', { seats: 3 }), simulate)).rejects.toBeInstanceOf(BalanceBusyError);
    release(report(8));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.report.gamesPlayed).toBe(8);
    expect(rb.report.gamesPlayed).toBe(8);
    expect(simulate).toHaveBeenCalledTimes(1);
  });
});

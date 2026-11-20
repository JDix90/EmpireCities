import { describe, expect, it } from 'vitest';
import { MAX_MATCH_SEED, newMatchSeed, toMatchSeed } from './matchSeed';

describe('match seeds', () => {
  it('folds anything into a positive 31-bit integer', () => {
    for (const value of [0, -5, 1.9, MAX_MATCH_SEED, MAX_MATCH_SEED + 7, 4294967295, Number.NaN, Infinity]) {
      const seed = toMatchSeed(value);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1);
      expect(seed).toBeLessThanOrEqual(MAX_MATCH_SEED);
    }
    expect(toMatchSeed(0)).toBe(1);
    expect(toMatchSeed(1234.8)).toBe(1234);
  });

  it('uses the injected source when given one', () => {
    expect(newMatchSeed(() => 0)).toBe(1);
    expect(newMatchSeed(() => 0.5)).toBe(Math.trunc(0.5 * MAX_MATCH_SEED));
  });

  it('draws different seeds from the default source', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => newMatchSeed()));
    expect(seeds.size).toBeGreaterThan(1);
    for (const seed of seeds) expect(Number.isInteger(seed) && seed >= 1 && seed <= MAX_MATCH_SEED).toBe(true);
  });
});

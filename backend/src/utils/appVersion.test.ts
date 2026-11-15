import { describe, it, expect } from 'vitest';
import { parseAppVersion, compareAppVersions, isBelowMinimumVersion } from './appVersion';

describe('parseAppVersion', () => {
  it('reads one to three numbers, missing parts as zero', () => {
    expect(parseAppVersion('1.4.2')).toEqual([1, 4, 2]);
    expect(parseAppVersion('1.4')).toEqual([1, 4, 0]);
    expect(parseAppVersion('2')).toEqual([2, 0, 0]);
    expect(parseAppVersion(' 1.0.0 ')).toEqual([1, 0, 0]);
  });

  it('refuses anything that is not a plain version', () => {
    for (const bad of ['', 'v1.2.0', '1.2.0-beta', '1.2.3.4', '1..2', '1.2.', 'latest', '1,2', '1.2.0 (45)', '-1.0']) {
      expect(parseAppVersion(bad), bad).toBeNull();
    }
    expect(parseAppVersion(undefined)).toBeNull();
    expect(parseAppVersion(120)).toBeNull();
    expect(parseAppVersion(['1.2.0'])).toBeNull();
  });
});

describe('compareAppVersions', () => {
  it('orders by number, not by text', () => {
    expect(compareAppVersions([1, 9, 0], [1, 10, 0])).toBeLessThan(0);
    expect(compareAppVersions([2, 0, 0], [1, 99, 99])).toBeGreaterThan(0);
    expect(compareAppVersions([1, 2, 0], [1, 2, 0])).toBe(0);
    expect(compareAppVersions([1, 2, 3], [1, 2, 4])).toBeLessThan(0);
  });
});

describe('isBelowMinimumVersion', () => {
  it('is true only for a version older than the minimum', () => {
    expect(isBelowMinimumVersion('1.0.0', '1.1.0')).toBe(true);
    expect(isBelowMinimumVersion('1.9', '1.10')).toBe(true);
    expect(isBelowMinimumVersion('1.1.0', '1.1.0')).toBe(false);
    expect(isBelowMinimumVersion('1.1', '1.1.0')).toBe(false);
    expect(isBelowMinimumVersion('2.0.0', '1.1.0')).toBe(false);
  });

  it('never blocks when there is no minimum, or either side is not a version', () => {
    expect(isBelowMinimumVersion('1.0.0', '')).toBe(false);
    expect(isBelowMinimumVersion('1.0.0', undefined)).toBe(false);
    expect(isBelowMinimumVersion('1.0.0', 'v2')).toBe(false);
    expect(isBelowMinimumVersion('', '2.0.0')).toBe(false);
    expect(isBelowMinimumVersion(undefined, '2.0.0')).toBe(false);
    expect(isBelowMinimumVersion('1.0.0-beta', '2.0.0')).toBe(false);
  });
});

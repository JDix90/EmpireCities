import { describe, expect, it } from 'vitest';
import { WARFRONT_DEBUG_KEY, formatMatchClock, loadDebugPref, parseDebugPref, saveDebugPref } from './debugPref';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('warfront debug preference', () => {
  it('is off unless the stored value is exactly the one it writes', () => {
    expect(parseDebugPref(null)).toBe(false);
    expect(parseDebugPref('')).toBe(false);
    expect(parseDebugPref('true')).toBe(false);
    expect(parseDebugPref('0')).toBe(false);
    expect(parseDebugPref('1')).toBe(true);
  });

  it('round-trips through storage and clears the key when turned off', () => {
    const storage = memoryStorage();
    expect(loadDebugPref(storage)).toBe(false);
    saveDebugPref(true, storage);
    expect(storage.data.get(WARFRONT_DEBUG_KEY)).toBe('1');
    expect(loadDebugPref(storage)).toBe(true);
    saveDebugPref(false, storage);
    expect(storage.data.has(WARFRONT_DEBUG_KEY)).toBe(false);
  });

  it('survives storage that throws or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDebugPref(broken)).toBe(false);
    expect(() => saveDebugPref(true, broken)).not.toThrow();
    expect(loadDebugPref(null)).toBe(false);
    expect(() => saveDebugPref(true, null)).not.toThrow();
  });
});

describe('formatMatchClock', () => {
  it('reads ticks as minutes and seconds', () => {
    expect(formatMatchClock(0, 15)).toBe('0:00');
    expect(formatMatchClock(14, 15)).toBe('0:00');
    expect(formatMatchClock(15, 15)).toBe('0:01');
    expect(formatMatchClock(15 * 65, 15)).toBe('1:05');
    expect(formatMatchClock(15 * 60 * 20, 15)).toBe('20:00');
  });

  it('falls back to the start for values it cannot read', () => {
    expect(formatMatchClock(Number.NaN, 15)).toBe('0:00');
    expect(formatMatchClock(-30, 15)).toBe('0:00');
    expect(formatMatchClock(300, 0)).toBe('0:00');
  });
});

import { describe, expect, it } from 'vitest';
import { FifoSet } from './fifoSet';

describe('FifoSet', () => {
  it('rejects duplicate adds', () => {
    const s = new FifoSet<string>(3);
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    expect(s.size).toBe(1);
  });

  it('evicts the oldest entry when capacity is exceeded', () => {
    const s = new FifoSet<string>(2);
    s.add('a');
    s.add('b');
    s.add('c'); // evicts 'a'
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('does not briefly drop all entries (regression: previous Set.clear() bug)', () => {
    const s = new FifoSet<string>(3);
    for (let i = 0; i < 100; i++) s.add(`id-${i}`);
    // Most recent 3 must still be present; we never went through a window
    // where the entire dedupe set was empty.
    expect(s.has('id-99')).toBe(true);
    expect(s.has('id-98')).toBe(true);
    expect(s.has('id-97')).toBe(true);
    expect(s.has('id-96')).toBe(false);
  });

  it('throws on non-positive cap', () => {
    expect(() => new FifoSet<string>(0)).toThrow();
    expect(() => new FifoSet<string>(-1)).toThrow();
  });
});

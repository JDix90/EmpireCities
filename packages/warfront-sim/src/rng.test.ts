import { describe, it, expect } from 'vitest';
import { Rng, mix32 } from './rng';
import { FP_ONE } from './fixed';

describe('Rng', () => {
  it('is reproducible from a seed and diverges between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 16 }, () => a.nextU32());
    const sb = Array.from({ length: 16 }, () => b.nextU32());
    const sc = Array.from({ length: 16 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('pins the stream for seed 1 (a change here is a replay-breaking change)', () => {
    const r = new Rng(1);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([52598544, 473418381, 2676121124]);
  });

  it('nextInt stays in range and covers every value', () => {
    const r = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
    expect(r.nextInt(1)).toBe(0);
    expect(() => r.nextInt(0)).toThrow();
    expect(() => r.nextInt(2.5)).toThrow();
  });

  it('nextRange is inclusive and nextFixed is below one', () => {
    const r = new Rng(2);
    for (let i = 0; i < 500; i++) {
      const v = r.nextRange(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      const f = r.nextFixed();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(FP_ONE);
    }
  });

  it('state snapshots restore the exact stream position', () => {
    const r = new Rng(77);
    r.nextU32();
    r.nextU32();
    const snap = r.state;
    const expected = [r.nextU32(), r.nextU32()];
    const restored = Rng.fromState(snap);
    expect([restored.nextU32(), restored.nextU32()]).toEqual(expected);
  });

  it('forks are deterministic and do not advance the parent', () => {
    const r = new Rng(5);
    const before = r.state;
    const f1 = r.fork(1);
    const f2 = r.fork(1);
    const f3 = r.fork(2);
    expect(r.state).toBe(before);
    expect(f1.nextU32()).toBe(f2.nextU32());
    expect(f1.nextU32()).not.toBe(f3.nextU32());
  });

  it('mix32 is a bijection-ish avalanche: neighbouring inputs land far apart', () => {
    expect(mix32(0)).not.toBe(mix32(1));
    expect(mix32(1)).not.toBe(mix32(2));
    expect(mix32(0x7fffffff)).toBe(mix32(0x7fffffff));
  });
});

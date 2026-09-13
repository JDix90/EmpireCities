import { FP_SHIFT, type Fixed, assertInt } from './fixed';

/**
 * Seeded 32-bit generator (mulberry32 step over a mixed seed). Integer-only, so a seed
 * reproduces the same stream on every engine. This is the ONLY source of randomness the
 * package may use — `Math.random` is banned by lint because one unseeded draw makes a
 * replay unreproducible.
 *
 * The state is a single uint32, cheap to snapshot into a hash or a save.
 */
export class Rng {
  private s: number;

  /** `seed` is any safe integer; it is reduced to a uint32 and stirred before use. */
  constructor(seed: number) {
    assertInt(seed, 'seed');
    this.s = mix32(seed >>> 0) >>> 0;
  }

  /** Rebuilds a generator from a snapshot taken with `state`. */
  static fromState(state: number): Rng {
    const r = new Rng(0);
    r.s = assertInt(state, 'rng state') >>> 0;
    return r;
  }

  /** Current internal state (uint32). */
  get state(): number {
    return this.s;
  }

  /** Uniform uint32. */
  nextU32(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, n). Rejection sampling, so no modulo bias. */
  nextInt(n: number): number {
    assertInt(n, 'nextInt bound');
    if (n <= 0 || n > 0xffffffff) throw new Error(`warfront-sim: nextInt bound out of range (${n})`);
    if (n === 1) return 0;
    const limit = 4294967296 - (4294967296 % n);
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }

  /** Uniform integer in [lo, hi] inclusive. */
  nextRange(lo: number, hi: number): number {
    assertInt(lo, 'nextRange lo');
    assertInt(hi, 'nextRange hi');
    if (hi < lo) throw new Error(`warfront-sim: nextRange hi < lo (${lo}, ${hi})`);
    return lo + this.nextInt(hi - lo + 1);
  }

  /** Uniform fixed value in [0, 1). */
  nextFixed(): Fixed {
    return this.nextU32() >>> (32 - FP_SHIFT);
  }

  /** True with probability num/den. */
  chance(num: number, den: number): boolean {
    return this.nextInt(den) < num;
  }

  /**
   * An independent stream derived from this one's state and a stream id — for
   * subsystems that must not perturb each other's draws. Does not advance `this`.
   */
  fork(streamId: number): Rng {
    assertInt(streamId, 'streamId');
    const r = new Rng(0);
    r.s = mix32((this.s ^ mix32(streamId >>> 0)) >>> 0) >>> 0;
    return r;
  }
}

/** Avalanching 32-bit mixer (lowbias32 constants). */
export function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

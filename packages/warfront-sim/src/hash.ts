import { splitInt53 } from './fixed';

/**
 * Incremental state hasher: two independent 32-bit hashes (FNV-1a and a Murmur3-style
 * mix) over a stream of integers, digested to 16 hex characters. Integer-only, no
 * dependencies, and the same digest on every engine — which is what a golden replay
 * test compares.
 */
export class StateHasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x9747b28c;
  private words = 0;

  /** Feeds one uint32. */
  word(w: number): this {
    const u = w >>> 0;
    // FNV-1a, byte by byte.
    let h1 = this.h1;
    h1 = Math.imul(h1 ^ (u & 0xff), 16777619);
    h1 = Math.imul(h1 ^ ((u >>> 8) & 0xff), 16777619);
    h1 = Math.imul(h1 ^ ((u >>> 16) & 0xff), 16777619);
    h1 = Math.imul(h1 ^ (u >>> 24), 16777619);
    this.h1 = h1 >>> 0;
    // Murmur3 body step.
    let k = Math.imul(u, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    let h2 = this.h2 ^ k;
    h2 = (h2 << 13) | (h2 >>> 19);
    this.h2 = (Math.imul(h2, 5) + 0xe6546b64) >>> 0;
    this.words += 1;
    return this;
  }

  /** Feeds a safe integer (negative allowed) as two words. */
  int(n: number): this {
    if (!Number.isSafeInteger(n)) {
      throw new Error(`warfront-sim: only safe integers can be hashed, got ${String(n)}`);
    }
    const [lo, hi] = splitInt53(n);
    return this.word(lo).word(hi);
  }

  /** Feeds a boolean as 0/1. */
  bool(b: boolean): this {
    return this.word(b ? 1 : 0);
  }

  /** Feeds an ASCII string (length, then char codes). Non-ASCII throws: no locale surprises. */
  ascii(s: string): this {
    this.word(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0x7f) throw new Error(`warfront-sim: non-ASCII character in hashed string: ${s}`);
      this.word(c);
    }
    return this;
  }

  /** 16 hex characters. Finalises copies of the running state, so it can be called repeatedly. */
  digest(): string {
    let h2 = this.h2 ^ (this.words * 4);
    h2 ^= h2 >>> 16;
    h2 = Math.imul(h2, 0x85ebca6b);
    h2 ^= h2 >>> 13;
    h2 = Math.imul(h2, 0xc2b2ae35);
    h2 ^= h2 >>> 16;
    return hex8(this.h1) + hex8(h2 >>> 0);
  }
}

function hex8(u: number): string {
  return (u >>> 0).toString(16).padStart(8, '0');
}

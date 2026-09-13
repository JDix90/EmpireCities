import { describe, it, expect } from 'vitest';
import {
  FP_ONE,
  FP_MAX,
  FP_MIN,
  assertFixed,
  assertInt,
  bitLength,
  fpDiv,
  fpLength,
  fpMul,
  fpRatio,
  fpSqrt,
  fromInt,
  idiv,
  imod,
  isqrt,
  splitInt53,
  toIntFloor,
  toIntRound,
} from './fixed';
import { Rng } from './rng';

// BigInt is the reference implementation: exact, but far too slow for the hot loop.
function refFloorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r !== 0n && (r < 0n) !== (b < 0n) ? q - 1n : q;
}

function refIsqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

describe('idiv / imod', () => {
  it('floors toward negative infinity for every sign combination', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-4);
    expect(idiv(7, -2)).toBe(-4);
    expect(idiv(-7, -2)).toBe(3);
    expect(idiv(8, -2)).toBe(-4);
    expect(imod(-7, 2)).toBe(1);
    expect(imod(7, 2)).toBe(1);
  });

  it('matches BigInt floor division on seeded random 53-bit operands', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 20000; i++) {
      const a = (rng.nextU32() * 2097152 + rng.nextInt(2097152)) * (rng.chance(1, 2) ? -1 : 1);
      const b = (rng.nextInt(1 << 30) + 1) * (rng.chance(1, 2) ? -1 : 1);
      expect(idiv(a, b)).toBe(Number(refFloorDiv(BigInt(a), BigInt(b))));
    }
  });

  it('is exact where Math.floor(a / b) alone is off by one', () => {
    // 2^53 - 1 divided by a large divisor: the double quotient rounds up to an integer.
    const a = 9007199254740991;
    const b = 3;
    expect(idiv(a, b)).toBe(Number(refFloorDiv(BigInt(a), BigInt(b))));
    expect(idiv(9007199254740991, 1073741824)).toBe(8388607);
  });

  it('throws on division by zero', () => {
    expect(() => idiv(1, 0)).toThrow(/division by zero/);
  });
});

describe('fpMul / fpDiv', () => {
  it('handles the textbook cases', () => {
    expect(fpMul(fromInt(3), fromInt(4))).toBe(fromInt(12));
    expect(fpMul(fromInt(3), FP_ONE >> 1)).toBe(fromInt(1) + (FP_ONE >> 1));
    expect(fpMul(fromInt(-3), FP_ONE >> 1)).toBe(-(fromInt(1) + (FP_ONE >> 1)));
    expect(fpDiv(fromInt(1), fromInt(4))).toBe(FP_ONE >> 2);
    expect(fpDiv(fromInt(-1), fromInt(4))).toBe(-(FP_ONE >> 2));
    expect(fpRatio(3, 10)).toBe(idiv(3 * FP_ONE, 10));
  });

  it('is exact across the whole int32 range (against BigInt)', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 20000; i++) {
      const a = rng.nextU32() | 0;
      const b = rng.nextU32() | 0;
      const ref = refFloorDiv(BigInt(a) * BigInt(b), 65536n);
      expect(fpMul(a, b)).toBe(Number(ref));
      if (b !== 0) {
        const refDiv = refFloorDiv(BigInt(a) * 65536n, BigInt(b));
        expect(fpDiv(a, b)).toBe(Number(refDiv));
      }
    }
  });
});

describe('isqrt / fpSqrt / fpLength', () => {
  it('matches BigInt isqrt on seeded random inputs up to 2^53', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 20000; i++) {
      const n = rng.nextU32() * 2097152 + rng.nextInt(2097152);
      expect(isqrt(n)).toBe(Number(refIsqrt(BigInt(n))));
    }
    for (let n = 0; n < 5000; n++) expect(isqrt(n)).toBe(Number(refIsqrt(BigInt(n))));
    expect(isqrt(9007199254740991)).toBe(94906265);
  });

  it('fpSqrt(4.0) is 2.0 and fpSqrt(2.0) floors', () => {
    expect(fpSqrt(fromInt(4))).toBe(fromInt(2));
    expect(fpSqrt(fromInt(2))).toBe(92681);
  });

  it('fpLength is the floor of the true length, and never wraps for large inputs', () => {
    expect(fpLength(fromInt(3), fromInt(4))).toBe(fromInt(5));
    expect(fpLength(0, fromInt(-7))).toBe(fromInt(7));
    const big = fpLength(FP_MAX, FP_MAX);
    // sqrt(2) * (2^31 - 1) ≈ 3037000498; a wrapped `<<` would have gone negative.
    expect(big).toBeGreaterThan(3036999000);
    expect(big).toBeLessThanOrEqual(3037000499);
    const rng = new Rng(5);
    for (let i = 0; i < 5000; i++) {
      const dx = (rng.nextU32() | 0) >> 4;
      const dy = (rng.nextU32() | 0) >> 4;
      const ref = Number(refIsqrt(BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy)));
      const got = fpLength(dx, dy);
      expect(got).toBeLessThanOrEqual(ref);
      expect(ref - got).toBeLessThanOrEqual(8);
    }
  });
});

describe('conversions and guards', () => {
  it('floors and rounds', () => {
    expect(toIntFloor(fromInt(2) + 1)).toBe(2);
    expect(toIntFloor(-1)).toBe(-1);
    expect(toIntRound(fromInt(2) + (FP_ONE >> 1))).toBe(3);
    expect(toIntRound(fromInt(2) + (FP_ONE >> 1) - 1)).toBe(2);
  });

  it('bitLength and splitInt53 cover both halves', () => {
    expect(bitLength(0)).toBe(0);
    expect(bitLength(1)).toBe(1);
    expect(bitLength(4294967295)).toBe(32);
    expect(bitLength(4294967296)).toBe(33);
    expect(bitLength(9007199254740991)).toBe(53);
    expect(splitInt53(1)).toEqual([1, 0]);
    expect(splitInt53(-1)).toEqual([4294967295, 4294967295]);
    expect(splitInt53(4294967296)).toEqual([0, 1]);
  });

  it('assertInt / assertFixed reject floats, NaN and out-of-range values', () => {
    expect(() => assertInt(1.5, 'x')).toThrow(/must be a safe integer/);
    expect(() => assertInt(Number.NaN, 'x')).toThrow(/must be a safe integer/);
    expect(() => assertFixed(FP_MAX + 1, 'x')).toThrow(/outside the 16.16 range/);
    expect(() => assertFixed(FP_MIN - 1, 'x')).toThrow(/outside the 16.16 range/);
    expect(assertFixed(FP_MAX, 'x')).toBe(FP_MAX);
  });
});

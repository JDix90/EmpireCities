/* eslint-disable no-restricted-syntax -- this is the ONE file allowed to use the `/`
   operator and float-shaped constants: every division in the package funnels through
   idiv/fpDiv below, where the result is floored back to an integer immediately and
   checked against an exact remainder. Everywhere else the operator is banned by the
   package's ESLint block (see eslint.config.mjs at the repo root). */

/**
 * 16.16 fixed-point arithmetic on plain JavaScript numbers.
 *
 * THE CONVENTION: every simulated quantity in this package is an integer. A "fixed"
 * value is an integer whose low 16 bits are the fraction, so 1.0 is 65536 (`FP_ONE`),
 * 0.5 is 32768, and a unit standing at cell (3, 7) has x = 3 << 16.
 *
 * Why integers and nothing else: IEEE-754 `+ - * /` are correctly rounded and therefore
 * reproducible everywhere, but `Math.sin`, `Math.pow`, `Math.exp` and friends are NOT
 * required to be — engines and even CPU generations differ in the last bit. One float
 * that reaches the state is enough for the match host, a replaying client and the
 * headless lab to drift apart silently, and the divergence surfaces thousands of ticks
 * later as "the replay desynced". So the state holds integers only, and the only
 * operations on them are the exactly-reproducible ones: integer add, subtract, multiply
 * (kept under 2^53 so the double is exact), floor division and bit twiddling.
 *
 * RANGE INVARIANT: a fixed value must fit in a signed 32-bit integer (±2^31). That is
 * what lets `fpMul` split one operand into 16-bit halves and keep every intermediate
 * product below 2^53 (exact in a double). Callers that construct fixed values from
 * outside input (commands, scenario files) validate them with `assertFixed`.
 */

export const FP_SHIFT = 16;
/** 1.0 in 16.16 fixed point. */
export const FP_ONE = 1 << FP_SHIFT;
/** 0.5 in 16.16 fixed point. */
export const FP_HALF = FP_ONE >> 1;
/** Largest representable fixed value (2^31 - 1). */
export const FP_MAX = 2147483647;
/** Smallest representable fixed value (-2^31). */
export const FP_MIN = -2147483648;

const TWO_32 = 4294967296;
const MAX_SAFE = 9007199254740991;

/**
 * A 16.16 fixed-point value. Type alias only — TypeScript cannot stop an int and a
 * fixed from mixing, so the name is the documentation: a parameter typed `Fixed`
 * expects the scaled form.
 */
export type Fixed = number;

/** Throws unless `n` is a safe integer. Use at every boundary where data comes in. */
export function assertInt(n: number, what: string): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new Error(`warfront-sim: ${what} must be a safe integer, got ${String(n)}`);
  }
  return n;
}

/** Throws unless `n` is an integer inside the signed 32-bit fixed-point range. */
export function assertFixed(n: number, what: string): Fixed {
  assertInt(n, what);
  if (n > FP_MAX || n < FP_MIN) {
    throw new Error(`warfront-sim: ${what} is outside the 16.16 range (±2^31), got ${n}`);
  }
  return n;
}

/** Integer → fixed (i * 65536). Exact for |i| < 2^37, but keep it inside ±2^15 for the range invariant. */
export function fromInt(i: number): Fixed {
  return i * FP_ONE;
}

/** Fixed → integer, rounding toward negative infinity. Requires the int32 range invariant. */
export function toIntFloor(f: Fixed): number {
  return f >> FP_SHIFT;
}

/** Fixed → integer, rounding to nearest (half up). */
export function toIntRound(f: Fixed): number {
  return (f + FP_HALF) >> FP_SHIFT;
}

/** Drops the fraction of a fixed value (floor to the nearest whole unit). */
export function fpFloor(f: Fixed): Fixed {
  return (f >> FP_SHIFT) << FP_SHIFT;
}

/**
 * Floor division of two integers, exact for any |a|, |b| < 2^53.
 *
 * `Math.floor(a / b)` alone can be off by one when the true quotient lies within half an
 * ulp of an integer; the remainder check below corrects that so the result is the true
 * floor, not the nearest double's floor.
 */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new Error('warfront-sim: integer division by zero');
  let q = Math.floor(a / b);
  const r = a - q * b;
  if (b > 0) {
    if (r < 0) q -= 1;
    else if (r >= b) q += 1;
  } else if (r > 0) {
    q -= 1;
  } else if (r <= b) {
    q += 1;
  }
  return q;
}

/** Integer modulo with a non-negative result for positive `b` (floor-division remainder). */
export function imod(a: number, b: number): number {
  return a - idiv(a, b) * b;
}

/**
 * Fixed × fixed → fixed, i.e. floor(a·b / 65536), computed exactly.
 *
 * `b` is split into its high and low 16 bits so that neither partial product exceeds
 * 2^47; a·b directly could reach 2^62 and lose bits. Both operands must satisfy the
 * int32 range invariant.
 */
export function fpMul(a: Fixed, b: Fixed): Fixed {
  const bh = b >> FP_SHIFT;
  const bl = b & 0xffff;
  return a * bh + Math.floor((a * bl) / FP_ONE);
}

/** Fixed ÷ fixed → fixed, i.e. floor(a·65536 / b), exact. `b` must be non-zero. */
export function fpDiv(a: Fixed, b: Fixed): Fixed {
  return idiv(a * FP_ONE, b);
}

/** Fixed × integer → fixed. Plain multiplication; the caller keeps the result in range. */
export function fpMulInt(f: Fixed, i: number): Fixed {
  return f * i;
}

/** Fixed ÷ integer → fixed (floor). */
export function fpDivInt(f: Fixed, i: number): Fixed {
  return idiv(f, i);
}

/** The fixed value num/den, e.g. fpRatio(3, 10) is 0.3. */
export function fpRatio(num: number, den: number): Fixed {
  return idiv(num * FP_ONE, den);
}

export function fpAbs(f: Fixed): Fixed {
  return f < 0 ? -f : f;
}

export function fpMin(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function fpMax(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

export function fpClamp(f: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return f < lo ? lo : f > hi ? hi : f;
}

/** Number of bits needed to represent a non-negative integer below 2^53 (0 for 0). */
export function bitLength(n: number): number {
  if (n < TWO_32) return 32 - Math.clz32(n);
  return 64 - Math.clz32(Math.floor(n / TWO_32));
}

/**
 * Integer square root: the largest integer r with r·r ≤ n. Exact for 0 ≤ n < 2^53.
 * Newton's method from a power-of-two seed; every intermediate is an integer.
 */
export function isqrt(n: number): number {
  if (n < 0) throw new Error(`warfront-sim: isqrt of a negative number (${n})`);
  if (n < 2) return n;
  let x = 1 << ((bitLength(n) + 1) >> 1);
  for (;;) {
    const y = (x + idiv(n, x)) >> 1;
    if (y >= x) return x;
    x = y;
  }
}

/** Square root of a non-negative fixed value, as a fixed value (floor). */
export function fpSqrt(f: Fixed): Fixed {
  return isqrt(f * FP_ONE);
}

/**
 * Length of the fixed vector (dx, dy), as a fixed value.
 *
 * Squaring an int32 can reach 2^62, so the inputs are first shifted down until their
 * squares fit under 2^53, and the root is shifted back up. That costs at most 2^shift
 * fixed units of precision (a few 1/65536ths of a cell on a 2000-cell map) — and the
 * loss is identical on every machine, which is the property that matters.
 */
export function fpLength(dx: Fixed, dy: Fixed): Fixed {
  let ax = fpAbs(dx);
  let ay = fpAbs(dy);
  let shift = 0;
  const limit = 1 << 25;
  while (ax >= limit || ay >= limit) {
    ax >>= 1;
    ay >>= 1;
    shift += 1;
  }
  // Multiply rather than `<<`: a shifted root can exceed int32, and `<<` would wrap it.
  return isqrt(ax * ax + ay * ay) * (1 << shift);
}

/**
 * Splits a safe integer into (low uint32, high int32-as-uint32) words, for hashing.
 * Two's-complement in the high word covers negatives.
 */
export function splitInt53(n: number): [lo: number, hi: number] {
  const hi = Math.floor(n / TWO_32);
  const lo = (n - hi * TWO_32) >>> 0;
  return [lo, hi >>> 0];
}

/** Guards for callers that combine large integers: true when the product is still exact. */
export function productIsExact(a: number, b: number): boolean {
  const p = Math.abs(a * b);
  return p <= MAX_SAFE;
}

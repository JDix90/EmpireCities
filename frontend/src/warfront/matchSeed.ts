/**
 * A fresh seed for each solo match.
 *
 * The simulation is a pure function of its seed and command log, and takes the seed as
 * an integer. This is the one place randomness enters a match, and it stays outside the
 * simulation package, whose lint forbids unseeded randomness precisely so that nothing
 * inside a match can depend on it.
 */

/** Largest seed handed out: a positive 31-bit integer, exact in every host. */
export const MAX_MATCH_SEED = 0x7fffffff;

/** Folds any number into a usable seed in [1, MAX_MATCH_SEED]. */
export function toMatchSeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const folded = Math.abs(Math.trunc(value)) % MAX_MATCH_SEED;
  return folded === 0 ? 1 : folded;
}

/**
 * Draws a seed. `random` is injectable so a test can pin it; by default it is the
 * browser's cryptographic source where there is one.
 */
export function newMatchSeed(random?: () => number): number {
  if (random) return toMatchSeed(random() * MAX_MATCH_SEED);
  const source = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (source && typeof source.getRandomValues === 'function') {
    const word = new Uint32Array(1);
    source.getRandomValues(word);
    return toMatchSeed(word[0]);
  }
  return toMatchSeed(Math.random() * MAX_MATCH_SEED);
}

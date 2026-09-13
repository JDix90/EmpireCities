import { FP_HALF, FP_ONE, type Fixed } from './fixed';

/**
 * Cell geometry, split out so modules that need a cell's centre — the sim, combat, the
 * bots — can have it without importing each other. `sim.ts` re-exports `cellCentre` so
 * every existing importer keeps working.
 */

/** Fixed position of the centre of cell column/row `i`. */
export function cellCentre(i: number): Fixed {
  return i * FP_ONE + FP_HALF;
}

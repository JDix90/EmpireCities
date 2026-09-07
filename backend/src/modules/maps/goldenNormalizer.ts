/**
 * Normalisation helpers for golden-output regression testing.
 *
 * Volatile fields (created_at, updated_at, background_image_url that varies
 * in dev vs prod) are stripped so that snapshot comparisons don't fail on
 * irrelevant changes.  List responses are sorted by map_id so that a different
 * insertion order doesn't cause false failures.
 *
 * Used by:
 *   • backend/src/modules/maps/mapsTransform.golden.test.ts  (Vitest, pure unit)
 */

const VOLATILE_KEYS = new Set(['created_at', 'updated_at', 'background_image_url']);

/** Strip volatile top-level keys from a plain object. */
export function stripVolatile<T extends Record<string, unknown>>(obj: T): Omit<T, 'created_at' | 'updated_at' | 'background_image_url'> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!VOLATILE_KEYS.has(k)) out[k] = v;
  }
  return out as Omit<T, 'created_at' | 'updated_at' | 'background_image_url'>;
}

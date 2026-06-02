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
 *   • scripts/capture-map-api-golden.ts                      (HTTP capture)
 *   • scripts/verify-map-api-golden.ts                       (HTTP verify)
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

/** Sort a list of summary objects by map_id for stable ordering. */
function sortByMapId<T extends { map_id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.map_id.localeCompare(b.map_id));
}

// ── Response normalizers (used by capture/verify scripts) ─────────────────────

/** Normalise GET /api/maps/eras */
export function normalizeErasBody(body: unknown): unknown {
  const { maps } = body as { maps: Record<string, unknown>[] };
  return {
    maps: sortByMapId(maps.map(stripVolatile) as { map_id: string }[]),
  };
}

/** Normalise GET /api/maps/community */
export function normalizeCommunityBody(body: unknown): unknown {
  const { maps, total } = body as { maps: Record<string, unknown>[]; total: number };
  return {
    total,
    maps: maps.map(stripVolatile),
  };
}

/** Normalise GET /api/maps/public */
export function normalizePublicBody(body: unknown): unknown {
  const { maps, total, page, pages } = body as {
    maps: Record<string, unknown>[];
    total: number;
    page: number;
    pages: number;
  };
  return {
    total,
    page,
    pages,
    maps: maps.map(stripVolatile),
  };
}

/** Normalise GET /api/maps/:mapId (full map detail) */
export function normalizeMapDetailBody(body: unknown): unknown {
  const { map } = body as { map: Record<string, unknown> };
  const stripped = stripVolatile(map);
  // Strip large arrays from the detail snapshot to keep fixture files readable;
  // territory/connection/region count is asserted separately.
  const { territories, connections, regions, ...meta } = stripped as Record<string, unknown>;
  return {
    ...meta,
    territory_count: Array.isArray(territories) ? territories.length : 0,
    connection_count: Array.isArray(connections) ? connections.length : 0,
    region_count: Array.isArray(regions) ? regions.length : 0,
  };
}

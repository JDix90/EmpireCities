/**
 * Types for the generated map catalog data.
 *
 * The VALUES in mapCatalog.generated.mjs are generated; this shape is not. It
 * mirrors `CatalogMap` / `CatalogRegion` in
 * backend/src/modules/maps/mapCatalog.ts — change one and change both.
 */

export interface CatalogRegion {
  name: string;
  /** Reinforcements per turn for holding the whole region. */
  bonus: number;
  territory_count: number;
}

export interface CatalogMap {
  slug: string;
  map_id: string;
  name: string;
  description: string;
  territory_count: number;
  connection_count: number;
  sea_route_count: number;
  era_theme: string;
  regions: CatalogRegion[];
}

export const MAP_CATALOG: CatalogMap[];
export const MAP_PAGE_COUNT: number;
/** The default board for each era, keyed by era id. */
export const ERA_MAPS: Record<string, CatalogMap>;

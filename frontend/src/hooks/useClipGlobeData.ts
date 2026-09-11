import { useMemo } from 'react';
import { inferWorldId } from '@borderfall/shared';
import { hasGeoMapping } from '../data/territoryGeoMapping';
import {
  buildTerritoryGlobeGeometries,
  type GlobeMapDataForGeometry,
} from '../utils/globeTerritoryGeometry';
import { buildClipGlobeData, type ClipGlobeViewConfig } from '../utils/clipGlobeData';
import type { ClipGlobeData } from '../utils/replayClipRenderer';
import { useTerritoryGeoSources } from './useTerritoryGeoSources';

/**
 * Resolves the globe geometry an exported replay clip is drawn from — the same
 * `buildTerritoryGlobeGeometries` output GlobeMap and the 2D map render, so a
 * shared clip shows the world players were actually looking at.
 *
 * Gated on `enabled` (the exporter passes its open state): the Natural Earth
 * sources are megabytes, and a viewer who never exports a clip should not pay
 * for them. When the replay's globe is already on screen the fetch is already
 * cached, so opening the exporter costs nothing.
 */

/** The subset of map data this needs; the replay's own map shape satisfies it. */
export interface ClipGlobeMapInput {
  map_id?: string;
  map_kind?: 'standard' | 'galaxy';
  globe_view?: ClipGlobeViewConfig;
  territories: Array<{ territory_id: string; region_id?: string; world_id?: string; globe_id?: string }>;
}

/**
 * Whether this map can resolve real geometry at all. Mirrors GameMap's own
 * gate: galaxy boards are four separate worlds rather than one globe, and a
 * canvas-only custom map has no geo hints to resolve.
 */
export function clipGlobeEligible(mapData: ClipGlobeMapInput): boolean {
  if (mapData.map_kind === 'galaxy') return false;
  return mapData.territories.some((t) => {
    const geoFields = t as Partial<{
      geo_polygon: unknown;
      geo_multipolygon: unknown;
      iso_codes: unknown;
      geo_config: unknown;
      admin1: unknown[];
    }>;
    return (
      Boolean(
        geoFields.geo_polygon ||
          geoFields.geo_multipolygon ||
          geoFields.iso_codes ||
          geoFields.geo_config ||
          (geoFields.admin1 && geoFields.admin1.length),
      ) || hasGeoMapping(t.territory_id)
    );
  });
}

/**
 * Territories that belong on the clip's globe: Earth's land tiles.
 *
 * Sea lanes are routes rather than ground and would paint the ocean in player
 * colors. Off-world tiles (the Space Age Moon) sit on their own sphere in the
 * live globe, so drawing them on Earth would scatter lunar basins across the
 * Pacific.
 */
export function clipGlobeTerritoryIds(mapData: ClipGlobeMapInput): string[] {
  return mapData.territories
    .filter((t) => t.region_id !== 'sea_routes' && inferWorldId({ ...t, region_id: t.region_id ?? '' }) === 'earth')
    .map((t) => t.territory_id);
}

export interface ClipGlobeResolution {
  /** The globe board, or null when this map has none (galaxy, canvas-only, load failure). */
  globe: ClipGlobeData | null;
  /**
   * The geo sources are still loading. Callers must wait: a clip generated now
   * would silently fall back to the flat board, and the deep-linked auto-start
   * fires the instant the exporter opens — exactly when the fetch is in flight.
   */
  pending: boolean;
}

export function useClipGlobeData(mapData: ClipGlobeMapInput, enabled: boolean): ClipGlobeResolution {
  const eligible = useMemo(() => enabled && clipGlobeEligible(mapData), [enabled, mapData]);
  const geoSources = useTerritoryGeoSources(mapData, eligible);

  const globe = useMemo(() => {
    if (!eligible || !geoSources) return null;
    try {
      const polygons = buildTerritoryGlobeGeometries(
        mapData as unknown as GlobeMapDataForGeometry,
        geoSources,
      );
      return buildClipGlobeData(polygons, {
        territoryIds: clipGlobeTerritoryIds(mapData),
        globeView: mapData.globe_view ?? null,
      });
    } catch (err) {
      // The flat authored polygons still render a usable clip — never fail the
      // export over geometry.
      console.warn('[clip] Globe geometry unavailable, falling back to flat board:', err);
      return null;
    }
  }, [eligible, geoSources, mapData]);

  return { globe, pending: eligible && !geoSources };
}

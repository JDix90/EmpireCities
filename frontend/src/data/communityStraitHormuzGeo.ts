/**
 * "Strait of Hormuz" — globe geometry from Natural Earth ne_10m admin-1 (see public/geo/strait_hormuz_admin1.json),
 * union + clip to the same [minLng, minLat, maxLng, maxLat] cells as the map grid.
 *
 * Skips map JSON `geo_polygon` on the globe when this mapping resolves so coastlines match the satellite basemap.
 */

import type { ClipBbox } from './territoryGeoMapping';

export interface StraitHormuzTerritoryGeoDef {
  /** Natural Earth iso_3166_2 codes (loaded from strait_hormuz_admin1.json) */
  admin1: string[];
  /**
   * Optional bbox clip. Omit when admin1 codes uniquely match a single territory
   * (Option 1: real coastlines). Provide when multiple territories share an
   * admin-1 polygon and need to be subdivided along grid lines.
   */
  clip_bbox?: ClipBbox;
  /** Optional: merge clipped admin-0 country polygon (e.g. SA for Empty Quarter with AE) */
  fill_country_iso?: string;
}

/**
 * Hybrid admin-1 design:
 * - Territories with sole ownership of admin-1 polygons render full real-world
 *   coastlines (no `clip_bbox`). Bahrain, Qatar (north + south split via
 *   non-overlapping municipality codes), Dubai-and-friends, Musandam, Fujairah,
 *   Sohar, Muscat, all use 1:1 unions.
 * - Iranian coast and Abu Dhabi/Empty-Quarter/Al-Ain share large admin-1s
 *   (IR-06, IR-14, IR-23, AE-AZ) that subdivide multiple gameplay territories,
 *   so they keep their grid `clip_bbox` to maintain the gridded design.
 */
export const COMMUNITY_STRAIT_HORMUZ_TERRITORY_GEO: Record<string, StraitHormuzTerritoryGeoDef> = {
  // --- Iran (admin-1s shared across multiple territories — keep grid bbox) ---
  hz_bushehr: { admin1: ['IR-06'], clip_bbox: [49.0, 27.0, 52.0, 28.0] },
  hz_firuzabad: { admin1: ['IR-14'], clip_bbox: [52.0, 27.0, 55.0, 28.0] },
  hz_lar: { admin1: ['IR-14'], clip_bbox: [55.0, 27.0, 57.5, 28.0] },
  hz_jask_int: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 27.0, 60.0, 28.0] },

  hz_dayyer: { admin1: ['IR-06'], clip_bbox: [49.0, 26.0, 51.5, 27.0] },
  hz_kangan: { admin1: ['IR-06'], clip_bbox: [51.5, 26.0, 53.5, 27.0] },
  hz_bastak: { admin1: ['IR-23'], clip_bbox: [53.5, 26.0, 55.5, 27.0] },
  hz_bandar: { admin1: ['IR-23'], clip_bbox: [55.5, 26.0, 57.5, 27.0] },
  hz_minab: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 26.0, 60.0, 27.0] },

  hz_kish: { admin1: ['IR-23'], clip_bbox: [52.0, 25.0, 54.0, 26.0] },
  hz_lavan: { admin1: ['IR-23'], clip_bbox: [54.0, 25.0, 55.5, 26.0] },
  hz_qeshm: { admin1: ['IR-23'], clip_bbox: [55.5, 25.0, 57.5, 26.0] },
  hz_jask_coast: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 25.0, 60.0, 26.0] },

  // --- Bahrain (1:1: all BH municipalities) ---
  hz_bahrain: { admin1: ['BH-13', 'BH-14', 'BH-15', 'BH-16', 'BH-17'] },

  // --- Qatar (split N/S via non-overlapping municipalities) ---
  // Northern Qatar = capital + most municipalities; Southern Qatar = Al Wakrah.
  hz_qatar: {
    admin1: ['QA-DA', 'QA-KH', 'QA-MS', 'QA-RA', 'QA-US', 'QA-ZA'],
  },
  hz_qatar_s: { admin1: ['QA-WA'] },

  // --- UAE Abu Dhabi block (single huge admin-1 split into 3 territories) ---
  hz_abu_dhabi: { admin1: ['AE-AZ'], clip_bbox: [51.5, 24.0, 53.5, 25.0] },
  hz_rub_khali: {
    admin1: ['AE-AZ'],
    clip_bbox: [49.0, 22.5, 53.0, 24.0],
    fill_country_iso: 'SA',
  },
  // Widened maxLat 24.0 -> 24.5 to include the northern AE-AZ extent
  // (Abu Dhabi reaches lat ~25.25 — prior bbox cut off the corridor's interior).
  hz_al_ain: { admin1: ['AE-AZ', 'OM-BU'], clip_bbox: [53.0, 22.5, 56.0, 24.5] },

  // --- UAE northern emirates + Oman (1:1 where admin-1 matches territory; bbox where it sprawls) ---
  // Sharjah (AE-SH) is a multi-emirate bundle that extends north + east into Fujairah/Musandam
  // territory; clip to Dubai-Sharjah coastal core to prevent overlap.
  hz_dubai: {
    admin1: ['AE-DU', 'AE-SH', 'AE-RK', 'AE-AJ', 'AE-UQ'],
    clip_bbox: [55.0, 24.6, 56.3, 25.5],
  },
  hz_musandam: { admin1: ['OM-MU'] },
  // OM-SH (Ash Sharqiyah South) was incorrectly listed here — it's a far-south
  // Oman governorate (lat 20–22.6) NOT adjacent to Fujairah. Use AE-FU only.
  hz_fujairah: { admin1: ['AE-FU'] },
  // OM-BJ (Al Batinah South) extends south past coastal Sohar into Muscat zone;
  // clip to the Batinah plateau to prevent overlap with hz_muscat.
  hz_sohar: { admin1: ['OM-BA', 'OM-BJ'], clip_bbox: [56.1, 23.5, 58.1, 24.0] },
  // OM-SS (Ash Sharqiyah North) is a sprawling interior region extending inland past
  // Al Ain / Empty Quarter; clip to coastal Muscat strip.
  hz_muscat: { admin1: ['OM-MA', 'OM-SS'], clip_bbox: [57.8, 22.8, 59.5, 23.7] },
};

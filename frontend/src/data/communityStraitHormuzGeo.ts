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
  clip_bbox: ClipBbox;
  /** Optional: merge clipped admin-0 country polygon (e.g. SA for Empty Quarter with AE) */
  fill_country_iso?: string;
}

/** Same grid as database/maps/buildCommunityStraitHormuz.js RAW rects — [w, s, e, n] */
export const COMMUNITY_STRAIT_HORMUZ_TERRITORY_GEO: Record<string, StraitHormuzTerritoryGeoDef> = {
  hz_bushehr: { admin1: ['IR-06'], clip_bbox: [49.0, 27.0, 52.0, 28.0] },
  hz_firuzabad: { admin1: ['IR-14'], clip_bbox: [52.0, 27.0, 55.0, 28.0] },
  hz_lar: { admin1: ['IR-14'], clip_bbox: [55.0, 27.0, 57.5, 28.0] },
  hz_jask_int: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 27.0, 60.0, 28.0] },

  hz_dayyer: { admin1: ['IR-06'], clip_bbox: [49.0, 26.0, 51.5, 27.0] },
  hz_kangan: { admin1: ['IR-06'], clip_bbox: [51.5, 26.0, 53.5, 27.0] },
  hz_bastak: { admin1: ['IR-23'], clip_bbox: [53.5, 26.0, 55.5, 27.0] },
  hz_bandar: { admin1: ['IR-23'], clip_bbox: [55.5, 26.0, 57.5, 27.0] },
  hz_minab: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 26.0, 60.0, 27.0] },

  hz_bahrain: {
    admin1: ['BH-13', 'BH-14', 'BH-15', 'BH-16', 'BH-17'],
    clip_bbox: [49.0, 25.0, 50.8, 26.0],
  },
  hz_qatar: {
    admin1: ['QA-DA', 'QA-KH', 'QA-MS', 'QA-RA', 'QA-US', 'QA-WA', 'QA-ZA'],
    clip_bbox: [50.8, 25.0, 52.0, 26.0],
  },
  hz_kish: { admin1: ['IR-23'], clip_bbox: [52.0, 25.0, 54.0, 26.0] },
  hz_lavan: { admin1: ['IR-23'], clip_bbox: [54.0, 25.0, 55.5, 26.0] },
  hz_qeshm: { admin1: ['IR-23'], clip_bbox: [55.5, 25.0, 57.5, 26.0] },
  hz_jask_coast: { admin1: ['IR-23', 'IR-13'], clip_bbox: [57.5, 25.0, 60.0, 26.0] },

  hz_qatar_s: {
    admin1: ['QA-DA', 'QA-KH', 'QA-MS', 'QA-RA', 'QA-US', 'QA-WA', 'QA-ZA'],
    clip_bbox: [49.0, 24.0, 51.5, 25.0],
  },
  hz_abu_dhabi: { admin1: ['AE-AZ'], clip_bbox: [51.5, 24.0, 53.5, 25.0] },
  hz_dubai: {
    admin1: ['AE-DU', 'AE-SH', 'AE-RK', 'AE-AJ', 'AE-UQ'],
    clip_bbox: [53.5, 24.0, 55.5, 25.0],
  },
  hz_musandam: { admin1: ['OM-MU'], clip_bbox: [55.5, 24.0, 57.0, 25.0] },
  hz_fujairah: {
    admin1: ['AE-FU', 'OM-SS', 'OM-SH'],
    clip_bbox: [57.0, 24.0, 60.0, 25.0],
  },

  hz_rub_khali: {
    admin1: ['AE-AZ'],
    clip_bbox: [49.0, 22.5, 53.0, 24.0],
    fill_country_iso: 'SA',
  },
  hz_al_ain: { admin1: ['AE-AZ', 'OM-BU'], clip_bbox: [53.0, 22.5, 56.0, 24.0] },
  hz_sohar: { admin1: ['OM-BA'], clip_bbox: [56.0, 22.5, 58.0, 24.0] },
  hz_muscat: { admin1: ['OM-MA', 'OM-SS'], clip_bbox: [58.0, 22.5, 60.0, 24.0] },
};

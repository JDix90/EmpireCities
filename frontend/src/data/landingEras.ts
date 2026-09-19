/**
 * The built-in eras the landing page showcases. Their copy (name, years,
 * blurb) lives in src/i18n/locales/<lang>/landing.json under `eras.<id>`, so
 * this table holds only what a translator never touches; localeBundles.test.ts
 * checks every id here has its three English strings.
 */
export type LandingEraScope = 'global' | 'regional';

export interface LandingEraCopy {
  label: string;
  years: string;
  summary: string;
}

export interface LandingEra {
  id: string;
  mapId: string;
  color: string;
  scope: LandingEraScope;
  territoryCount: number;
  /** "2–6", rendered through the `eras.playersRange` string. */
  playersRange: string;
  /**
   * Copy for a map with no entry in the landing bundle — community maps are
   * data-driven and named by their authors. Built-in eras leave this unset.
   */
  fallback?: LandingEraCopy;
  /** Per-era glyph so cards read as distinct maps, not identical placeholders. */
  icon?: string;
}

export const LANDING_ERAS: LandingEra[] = [
  { id: 'ancient', mapId: 'era_ancient', color: '#c9a84c', scope: 'global', territoryCount: 28, playersRange: '2–6' },
  { id: 'medieval', mapId: 'era_medieval', color: '#8b6914', scope: 'global', territoryCount: 29, playersRange: '2–6' },
  { id: 'discovery', mapId: 'era_discovery', color: '#2e7d9e', scope: 'global', territoryCount: 34, playersRange: '2–6' },
  { id: 'ww2', mapId: 'era_ww2', color: '#5a5a5a', scope: 'global', territoryCount: 35, playersRange: '2–6' },
  { id: 'coldwar', mapId: 'era_coldwar', color: '#1a3a5c', scope: 'global', territoryCount: 44, playersRange: '2–6' },
  { id: 'modern', mapId: 'era_modern', color: '#2ecc71', scope: 'global', territoryCount: 43, playersRange: '2–6' },
  { id: 'acw', mapId: 'era_acw', color: '#6b5344', scope: 'regional', territoryCount: 18, playersRange: '2–4' },
  { id: 'risorgimento', mapId: 'era_risorgimento', color: '#008C45', scope: 'regional', territoryCount: 14, playersRange: '2–4' },
  { id: 'space_age', mapId: 'era_space_age', color: '#8E9AF2', scope: 'global', territoryCount: 55, playersRange: '2–6' },
  { id: 'galaxy_age', mapId: 'era_galaxy', color: '#9FA8DA', scope: 'global', territoryCount: 12, playersRange: '2–4' },
];

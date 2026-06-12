/**
 * Client-side era + theater pairing compatibility (mirrors backend lobbyEraMapCompatibility.ts).
 */

import { GameMap } from '../services/mapService';
import {
  LOBBY_ERA_MAP_IDS,
  LOBBY_ERAS,
  CURATED_COMMUNITY_MAP_IDS,
} from '../constants/lobbyMapOptions';
import { COMMUNITY_MAP_TITLES, ERA_LABELS } from '../constants/gameLobbyLabels';
import { getCustomMapImmersion } from '../data/customMapImmersion';

export type CompatibilityWarningTier = 'info' | 'warn';

export interface CompatibilityWarning {
  tier: CompatibilityWarningTier;
  message: string;
}

export interface MapCompatibilityMeta {
  map_id: string;
  era_theme?: string;
  map_kind?: 'standard' | 'galaxy';
  territory_count: number;
  sea_connection_count: number;
  has_moon_territories: boolean;
}

export interface EraMapCompatibilityInput {
  era_id: string;
  map_id: string;
  settings: Record<string, unknown>;
  is_ranked?: boolean;
  is_admin?: boolean;
  player_count?: number;
  map_meta?: MapCompatibilityMeta | null;
}

export interface EraMapCompatibilityResult {
  allowed: boolean;
  hardBlock: string | null;
  warnings: CompatibilityWarning[];
}

export const LOBBY_SELECTABLE_THEATER_MAP_IDS = [
  ...Object.values(LOBBY_ERA_MAP_IDS),
  ...CURATED_COMMUNITY_MAP_IDS,
] as const;

export const LOBBY_THEATER_OPTIONS: Array<{ map_id: string; label: string }> = [
  ...LOBBY_ERAS.map((e) => ({
    map_id: LOBBY_ERA_MAP_IDS[e.id],
    label: e.label,
  })),
  ...CURATED_COMMUNITY_MAP_IDS.map((mapId) => ({
    map_id: mapId,
    label: COMMUNITY_MAP_TITLES[mapId] ?? mapId,
  })),
];

export function recommendedRulesEraForTheater(mapId: string): string | null {
  const immersion = getCustomMapImmersion(mapId);
  if (immersion) return immersion.recommended_rules_era;
  const fromBuiltin = Object.entries(LOBBY_ERA_MAP_IDS).find(([, id]) => id === mapId)?.[0];
  return fromBuiltin ?? null;
}

export function formatTheaterMapLabel(mapId: string): string {
  if (COMMUNITY_MAP_TITLES[mapId]) return COMMUNITY_MAP_TITLES[mapId];
  const eraKey = Object.entries(LOBBY_ERA_MAP_IDS).find(([, id]) => id === mapId)?.[0];
  if (eraKey) return ERA_LABELS[eraKey] ?? mapId;
  const slug = mapId.replace(/^era_/, '');
  return slug
    .split('_')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function formatRulesAndTheaterDisplay(eraId: string, mapId: string): string {
  const rules = ERA_LABELS[eraId] ?? eraId;
  const theater = formatTheaterMapLabel(mapId);
  if (LOBBY_ERA_MAP_IDS[eraId] === mapId) {
    return rules;
  }
  return `${theater} · ${rules} rules`;
}

export function buildMapMetaFromGameMap(map: GameMap): MapCompatibilityMeta {
  const sea_connection_count = map.connections.filter((c) => c.type === 'sea').length;
  const has_moon_territories = map.territories.some(
    (t) =>
      t.globe_id === 'moon' ||
      t.region_id === 'lunar_surface' ||
      t.territory_id.startsWith('moon_'),
  );
  return {
    map_id: map.map_id,
    era_theme: map.era_theme,
    map_kind: map.map_kind,
    territory_count: map.territories.length,
    sea_connection_count,
    has_moon_territories,
  };
}

export function evaluateEraMapCompatibility(input: EraMapCompatibilityInput): EraMapCompatibilityResult {
  const warnings: CompatibilityWarning[] = [];
  const { era_id, map_id, settings } = input;

  if (!(era_id in LOBBY_ERA_MAP_IDS)) {
    return { allowed: false, hardBlock: 'Invalid rules era', warnings };
  }

  if (!LOBBY_SELECTABLE_THEATER_MAP_IDS.includes(map_id as (typeof LOBBY_SELECTABLE_THEATER_MAP_IDS)[number])) {
    return { allowed: false, hardBlock: 'That theater map is not available in the lobby', warnings };
  }

  const isGalactic = era_id === 'galaxy_age' || map_id === 'era_galaxy';
  if (isGalactic && !input.is_admin) {
    return { allowed: false, hardBlock: 'Galactic Age is only available to administrators', warnings };
  }

  if (settings.tutorial === true) {
    return { allowed: false, hardBlock: 'Pairing cannot be changed in tutorial games', warnings };
  }
  if (settings.is_campaign === true) {
    return { allowed: false, hardBlock: 'Pairing cannot be changed in campaign games', warnings };
  }
  if (typeof settings.daily_challenge_date === 'string' && settings.daily_challenge_date.length > 0) {
    return { allowed: false, hardBlock: 'Pairing cannot be changed in daily challenge games', warnings };
  }
  if (input.is_ranked) {
    return { allowed: false, hardBlock: 'Pairing cannot be changed in ranked games', warnings };
  }

  if (settings.era_advancement_enabled === true && era_id !== 'ancient') {
    return {
      allowed: false,
      hardBlock: 'Era Advancement requires Ancient rules — pick Ancient or disable Era Advancement',
      warnings,
    };
  }

  const meta = input.map_meta;
  const playerCount = input.player_count ?? 0;
  if (meta && playerCount > 0 && playerCount > meta.territory_count) {
    return {
      allowed: false,
      hardBlock: `This theater has only ${meta.territory_count} territories — too few for ${playerCount} players`,
      warnings,
    };
  }

  const recommended = recommendedRulesEraForTheater(map_id);
  if (recommended && recommended !== era_id) {
    const theater = formatTheaterMapLabel(map_id);
    const suggested = ERA_LABELS[recommended] ?? recommended;
    warnings.push({
      tier: 'info',
      message: `Suggested rules for ${theater}: ${suggested}. Event cards and factions follow your selected rules era.`,
    });
  }

  // Only a genuinely mismatched map deserves the note. The previous condition
  // also compared the ERA id against its MAP id (`'ancient' !== 'era_ancient'`,
  // true for every era), so the "custom pairing" warning showed on every game
  // — including the defaults a brand-new player creates.
  if (map_id !== LOBBY_ERA_MAP_IDS[era_id]) {
    warnings.push({
      tier: 'info',
      message: 'Custom pairing — event card text may reference theaters other than this map.',
    });
  }

  if (meta) {
    if (settings.naval_enabled === true && meta.sea_connection_count < 3) {
      warnings.push({
        tier: 'warn',
        message: 'Naval warfare is on, but this theater has few sea routes — fleets may matter less.',
      });
    }

    if (
      (settings.economy_enabled === true ||
        settings.tech_trees_enabled === true ||
        settings.stability_enabled === true) &&
      meta.territory_count < 12
    ) {
      warnings.push({
        tier: 'warn',
        message: 'Economy, tech, or stability on a small theater can feel cramped.',
      });
    }

    if (settings.factions_enabled === true && recommended && recommended !== era_id) {
      warnings.push({
        tier: 'warn',
        message: 'Factions use your rules-era roster — they may not match this theater historically.',
      });
    }

    if (era_id === 'space_age' && !meta.has_moon_territories && map_id !== 'era_space_age') {
      warnings.push({
        tier: 'warn',
        message: 'Space Age rules include lunar tech, but this theater has no Moon territories to claim.',
      });
    }

    if (era_id === 'galaxy_age' && meta.map_kind !== 'galaxy') {
      warnings.push({
        tier: 'warn',
        message: 'Galactic Age rules expect multi-world maps — hyperspace mechanics may not engage here.',
      });
    }

    const theme = meta.era_theme;
    if (theme && theme !== 'custom' && theme !== era_id && LOBBY_ERA_MAP_IDS[era_id] !== map_id) {
      const themeLabel = ERA_LABELS[theme] ?? theme;
      const rulesLabel = ERA_LABELS[era_id] ?? era_id;
      warnings.push({
        tier: 'warn',
        message: `Theater theme (${themeLabel}) differs from rules era (${rulesLabel}).`,
      });
    }
  }

  return { allowed: true, hardBlock: null, warnings };
}

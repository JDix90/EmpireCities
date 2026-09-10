import {
  ASCENSION_GALAXY_MAP_ID,
  ASCENSION_GALAXY_SPINE_ID,
  ASCENSION_GALAXY_START_ERA,
  COMMUNITY_MAP_LABELS,
  CURATED_COMMUNITY_MAP_IDS,
  EXTRA_THEATER_MAP_LABELS,
  LOBBY_ERA_MAP_IDS,
  LOBBY_ERA_LABELS,
  LOBBY_RULES_ERA_IDS,
  type LobbyMapChangeValue,
} from './lobbyMapChange';
import { getSpineById, isAscensionEra } from '../eraAdvancement/spines';
import type { EraId } from '../../types';

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

export const GALAXY_FACTIONS_REQUIRED_ERROR =
  'Galactic Age needs Asymmetric Factions on — each player commands one world';

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

/** All built-in era maps + curated community theaters selectable in lobby. */
export const LOBBY_SELECTABLE_THEATER_MAP_IDS = new Set([
  ...Object.values(LOBBY_ERA_MAP_IDS),
  ...CURATED_COMMUNITY_MAP_IDS,
  ASCENSION_GALAXY_MAP_ID,
]);

export const ASCENSION_GALAXY_ERA_ERROR =
  'Space to Stars starts under Space Age rules — pick Space Age or a different theater';
export const ASCENSION_GALAXY_ADVANCEMENT_ERROR =
  'Space to Stars needs Era Advancement on — the three far worlds only open when a player reaches the Galactic Age';

const COMMUNITY_RECOMMENDED_RULES_ERA: Record<string, string> = {
  community_flooded_north_america: 'modern',
  community_charlemagne_814: 'medieval',
  community_roman_empire_117: 'ancient',
  community_mongol_empire: 'medieval',
  community_napoleonic_europe: 'discovery',
  community_sengoku_japan: 'medieval',
  community_balkanized_usa: 'modern',
  community_fractured_china: 'modern',
  community_balkanized_india: 'modern',
  community_uncolonized_africa: 'discovery',
  community_south_america: 'modern',
  community_divided_japan: 'coldwar',
  community_fractured_russia: 'modern',
  community_byzantium_megali: 'medieval',
  community_balkanized_spain: 'modern',
  community_nusantara: 'discovery',
  community_britain_925: 'medieval',
  community_horn_africa: 'coldwar',
  community_australia_1337: 'medieval',
  community_14_nations: 'discovery',
  community_strait_hormuz: 'coldwar',
};

export function isLobbySelectableTheaterMap(mapId: string): boolean {
  return LOBBY_SELECTABLE_THEATER_MAP_IDS.has(mapId);
}

export function recommendedRulesEraForTheater(mapId: string): string | null {
  if (COMMUNITY_RECOMMENDED_RULES_ERA[mapId]) {
    return COMMUNITY_RECOMMENDED_RULES_ERA[mapId];
  }
  const fromBuiltin = Object.entries(LOBBY_ERA_MAP_IDS).find(([, id]) => id === mapId)?.[0];
  return fromBuiltin ?? null;
}

export function formatTheaterMapLabel(mapId: string): string {
  if (EXTRA_THEATER_MAP_LABELS[mapId]) return EXTRA_THEATER_MAP_LABELS[mapId];
  if (COMMUNITY_MAP_LABELS[mapId]) return COMMUNITY_MAP_LABELS[mapId];
  const eraKey = Object.entries(LOBBY_ERA_MAP_IDS).find(([, id]) => id === mapId)?.[0];
  if (eraKey) return LOBBY_ERA_LABELS[eraKey] ?? mapId;
  const slug = mapId.replace(/^era_/, '');
  return slug
    .split('_')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function formatRulesAndTheaterDisplay(eraId: string, mapId: string): string {
  const rules = LOBBY_ERA_LABELS[eraId] ?? eraId;
  const theater = formatTheaterMapLabel(mapId);
  if (LOBBY_ERA_MAP_IDS[eraId] === mapId) {
    return rules;
  }
  return `${theater} · ${rules} rules`;
}

export function buildMapMetaFromDoc(map: {
  map_id: string;
  era_theme?: string;
  map_kind?: 'standard' | 'galaxy';
  territories: Array<{ globe_id?: string; region_id?: string; territory_id?: string }>;
  connections: Array<{ type?: string }>;
}): MapCompatibilityMeta {
  const sea_connection_count = map.connections.filter((c) => c.type === 'sea').length;
  const has_moon_territories = map.territories.some(
    (t) =>
      t.globe_id === 'moon' ||
      t.region_id === 'lunar_surface' ||
      (t.territory_id?.startsWith('moon_') ?? false),
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

  if (!LOBBY_RULES_ERA_IDS.has(era_id)) {
    return { allowed: false, hardBlock: 'Invalid rules era', warnings };
  }

  if (!isLobbySelectableTheaterMap(map_id)) {
    return { allowed: false, hardBlock: 'That theater map is not available in the lobby', warnings };
  }

  const isGalactic = era_id === 'galaxy_age' || map_id === 'era_galaxy';
  if (isGalactic && !input.is_admin) {
    return { allowed: false, hardBlock: 'Galactic Age is only available to administrators', warnings };
  }

  // Space to Stars carries the Galactic Age's content behind its second spine
  // step, so it rides the same admin gate — and it only makes sense as an
  // advancement game: with advancement off the era floor never rises, and the
  // 48 exo tiles are content nobody can ever reach.
  if (map_id === ASCENSION_GALAXY_MAP_ID) {
    if (!input.is_admin) {
      return { allowed: false, hardBlock: 'Space to Stars is only available to administrators', warnings };
    }
    if (era_id !== ASCENSION_GALAXY_START_ERA) {
      return { allowed: false, hardBlock: ASCENSION_GALAXY_ERA_ERROR, warnings };
    }
    if (settings.era_advancement_enabled !== true) {
      return { allowed: false, hardBlock: ASCENSION_GALAXY_ADVANCEMENT_ERROR, warnings };
    }
  }

  // The era's designed start — one faction per world — is produced by
  // tryDistributeGalaxyAgeFactionHomeworlds, which fires ONLY for exactly four
  // seats holding four distinct galaxy factions. Every other shape silently
  // falls through to geographic distribution across all 64 tiles, so each seat
  // begins holding territory on worlds it cannot reach: measured at 2p and 3p,
  // every seat starts spread over three or four worlds, and a 2p game ends in
  // ~16 turns because both players open with half the board. Block the shapes
  // that cannot produce the designed start rather than shipping the fallback.
  // Seat count is NOT checked here: this evaluator also runs on the in-lobby
  // map-change path, which passes the humans who have joined so far rather than
  // the final seat count (AI seats are added at create), so an exact-4 rule
  // would block a half-filled lobby from ever selecting the era. The create
  // boundary owns that rule — see galaxyPlayerCountRejection in games.routes.ts.
  // Factions is a real lobby setting on both paths, so it belongs here.
  // Must be explicitly ON: normalizeGameSettings persists
  // `factions_enabled: factionsEnabled || undefined`, so an off game arrives
  // here with the key absent rather than false.
  if (isGalactic && settings.factions_enabled !== true) {
    return { allowed: false, hardBlock: GALAXY_FACTIONS_REQUIRED_ERROR, warnings };
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

  if (settings.era_advancement_enabled === true) {
    // Board-transform games anchor an ascension spine at whatever era they start
    // on (the world then transforms forward from there), so any era on the
    // ascension line is a valid start. Other (growth) games are pinned to the
    // configured spine's fixed start era — all built-in spines begin at Ancient.
    const boardTransform = settings.era_advancement_board_transform === true;
    if (map_id === ASCENSION_GALAXY_MAP_ID && settings.era_advancement_spine_id === ASCENSION_GALAXY_SPINE_ID) {
      // Already pinned to space_age above; the spine's own start era agrees.
    } else if (boardTransform && isAscensionEra(era_id as EraId)) {
      // valid mid-line start — fall through to map/meta checks
    } else {
      const spineId = typeof settings.era_advancement_spine_id === 'string'
        ? settings.era_advancement_spine_id
        : undefined;
      const startEra = getSpineById(spineId).steps[0]?.era_id;
      if (startEra && era_id !== startEra) {
        const startLabel = LOBBY_ERA_LABELS[startEra] ?? startEra;
        return {
          allowed: false,
          hardBlock: `Era Advancement starts in ${startLabel} — pick ${startLabel} rules or disable Era Advancement`,
          warnings,
        };
      }
    }
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
    const suggested = LOBBY_ERA_LABELS[recommended] ?? recommended;
    warnings.push({
      tier: 'info',
      message: `Suggested rules for ${theater}: ${suggested}. Event cards and factions follow your selected rules era.`,
    });
  }

  if (era_id !== LOBBY_ERA_MAP_IDS[era_id] || map_id !== LOBBY_ERA_MAP_IDS[era_id]) {
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

    const theme = meta.era_theme;
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

    if (theme && theme !== 'custom' && theme !== era_id && LOBBY_ERA_MAP_IDS[era_id] !== map_id) {
      const themeLabel = LOBBY_ERA_LABELS[theme] ?? theme;
      const rulesLabel = LOBBY_ERA_LABELS[era_id] ?? era_id;
      warnings.push({
        tier: 'warn',
        message: `Theater theme (${themeLabel}) differs from rules era (${rulesLabel}).`,
      });
    }
  }

  return { allowed: true, hardBlock: null, warnings };
}

export function validateLobbyMapChangePair(
  value: LobbyMapChangeValue,
  opts: {
    isAdmin: boolean;
    settings?: Record<string, unknown>;
    is_ranked?: boolean;
    player_count?: number;
    map_meta?: MapCompatibilityMeta | null;
  },
): string | null {
  const result = evaluateEraMapCompatibility({
    era_id: value.era_id,
    map_id: value.map_id,
    settings: opts.settings ?? {},
    is_admin: opts.isAdmin,
    is_ranked: opts.is_ranked,
    player_count: opts.player_count,
    map_meta: opts.map_meta,
  });
  return result.hardBlock;
}

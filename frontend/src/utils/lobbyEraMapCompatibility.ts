/**
 * Client-side era + theater pairing compatibility (mirrors backend lobbyEraMapCompatibility.ts).
 */

import { GameMap } from '../services/mapService';
import {
  ASCENSION_GALAXY_LABEL,
  ASCENSION_GALAXY_MAP_ID,
  ASCENSION_GALAXY_SPINE_ID,
  ASCENSION_GALAXY_START_ERA,
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
  /**
   * The seat cap the create form asks for. Only the Galactic Age reads it: four
   * (Colonies below four, one world each at four) or eight (the Schism).
   * Absent — the in-lobby Map & Era vote — reads as four.
   */
  max_players?: number;
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
  ASCENSION_GALAXY_MAP_ID,
] as const;

export const LOBBY_THEATER_OPTIONS: Array<{ map_id: string; label: string }> = [
  ...LOBBY_ERAS.map((e) => ({
    map_id: LOBBY_ERA_MAP_IDS[e.id],
    label: e.label,
  })),
  { map_id: ASCENSION_GALAXY_MAP_ID, label: `${ASCENSION_GALAXY_LABEL} — Coming Soon` },
  ...CURATED_COMMUNITY_MAP_IDS.map((mapId) => ({
    map_id: mapId,
    label: COMMUNITY_MAP_TITLES[mapId] ?? mapId,
  })),
];

export const ASCENSION_GALAXY_ERA_ERROR =
  'Space to Stars starts under Space Age rules — pick Space Age or a different theater';
export const ASCENSION_GALAXY_ADVANCEMENT_ERROR =
  'Space to Stars needs Era Advancement on — the three far worlds only open when a player reaches the Galactic Age';

export function recommendedRulesEraForTheater(mapId: string): string | null {
  if (mapId === ASCENSION_GALAXY_MAP_ID) return ASCENSION_GALAXY_START_ERA;
  const immersion = getCustomMapImmersion(mapId);
  if (immersion) return immersion.recommended_rules_era;
  const fromBuiltin = Object.entries(LOBBY_ERA_MAP_IDS).find(([, id]) => id === mapId)?.[0];
  return fromBuiltin ?? null;
}

export function formatTheaterMapLabel(mapId: string): string {
  if (mapId === ASCENSION_GALAXY_MAP_ID) return ASCENSION_GALAXY_LABEL;
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

/**
 * Seats a Galactic Age game supports: two to eight. Four home worlds, and below
 * four the unclaimed worlds open as colonies; from five, the Schism, two houses
 * to a shared world: one world per seat over four at five to seven (the Partial
 * Schism), every world at eight. Mirrors backend lobbyCapacity.ts.
 */
export const GALAXY_MIN_PLAYERS = 2;
/** One home world each: Colonies below this, the classic start at it. */
export const GALAXY_MAX_PLAYERS = 4;
/** The full Schism: two houses to each of the four worlds. */
export const GALAXY_SCHISM_PLAYERS = 8;
export const GALAXY_SEAT_COUNTS: readonly number[] = [2, 3, 4, 5, 6, 7, GALAXY_SCHISM_PLAYERS];
export const GALAXY_PLAYER_COUNT_ERROR =
  `Galactic Age seats ${GALAXY_MIN_PLAYERS} to ${GALAXY_SCHISM_PLAYERS} players — one per home world up to ${GALAXY_MAX_PLAYERS}, and from ${GALAXY_MAX_PLAYERS + 1} the Schism, two houses to a shared world`;
/** The create form's own refusal: more than four seats on a lobby without the Schism. */
export const GALAXY_SCHISM_NEEDED_ERROR =
  `More than ${GALAXY_MAX_PLAYERS} players need the Schism, where two houses share a world — switch it on to seat up to ${GALAXY_SCHISM_PLAYERS}`;
export const GALAXY_FACTIONS_REQUIRED_ERROR =
  'Galactic Age needs Asymmetric Factions on — each player commands one world';

/**
 * Seats one faction may take in a lobby: two in a Galactic Age lobby that can
 * seat a Schism (five or more seats: a faction picked twice splits its world
 * between two houses), one elsewhere. Mirrors backend `seatsPerFaction`
 * (lobbyCapacity.ts), which the faction pick enforces.
 */
export function seatsPerFaction(
  eraId: string | null | undefined,
  mapId: string | null | undefined,
  settings: { max_players?: unknown } | null | undefined,
): number {
  const galactic = eraId === 'galaxy_age' || mapId === 'era_galaxy';
  const cap = typeof settings?.max_players === 'number' ? settings.max_players : 8;
  return galactic && cap > GALAXY_MAX_PLAYERS ? 2 : 1;
}

/**
 * A Galactic Age 2v2 lobby's two sides, by the factions whose home worlds pair
 * up across the ring's gaps. Mirrors backend GALAXY_2V2_PAIRS (galaxyTeams.ts).
 */
export const GALAXY_2V2_FACTION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['stellar_mandate', 'forge_syndicate'],
  ['helion_navigators', 'void_custodians'],
];

/**
 * How a Galactic Age lobby's teams form, for the waiting room: in 2v2 a
 * player's faction is their side; with Allied houses the seats on a faction
 * are one (a player alone on a faction holds its world whole, a side of one).
 * Null for a free-for-all lobby.
 */
export function galaxyTeamPickNote(
  eraId: string | null | undefined,
  mapId: string | null | undefined,
  settings: { max_players?: unknown; galaxy_2v2?: unknown; galaxy_house_relations?: unknown } | null | undefined,
  factionName: (factionId: string) => string,
): string | null {
  const galactic = eraId === 'galaxy_age' || mapId === 'era_galaxy';
  if (!galactic || !settings) return null;
  const cap = typeof settings.max_players === 'number' ? settings.max_players : 8;
  if (cap > GALAXY_MAX_PLAYERS && settings.galaxy_house_relations === 'allied') {
    return 'Allied houses: the players on each faction are one team and share its world. Pick the same faction as a friend to play on one side.';
  }
  if (cap === GALAXY_MAX_PLAYERS && settings.galaxy_2v2 === true) {
    const [a, b] = GALAXY_2V2_FACTION_PAIRS.map((pair) => pair.map(factionName).join(' and '));
    return `2v2: your faction is your team, ${a} against ${b}.`;
  }
  return null;
}

/**
 * How a free-for-all Schism lobby deals factions, for the waiting room: two
 * players on one faction split its world as rival houses, and below eight
 * players only so many worlds split. Null for any other lobby (an Allied one
 * has galaxyTeamPickNote instead).
 */
export function galaxySchismPickNote(
  eraId: string | null | undefined,
  mapId: string | null | undefined,
  settings: { max_players?: unknown; galaxy_house_relations?: unknown } | null | undefined,
): string | null {
  const galactic = eraId === 'galaxy_age' || mapId === 'era_galaxy';
  if (!galactic || !settings) return null;
  const cap = typeof settings.max_players === 'number' ? settings.max_players : 8;
  if (cap <= GALAXY_MAX_PLAYERS || settings.galaxy_house_relations === 'allied') return null;
  return 'Schism: two players on one faction split its world as rival houses, and a player alone on a faction takes half its world, the other half unclaimed. With five to seven players one world splits per player over four — if more factions are picked twice, the deal draws which stay shared.';
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

  // Space to Stars carries the Galactic Age behind its second spine step, so it
  // rides the same admin gate — and it only makes sense as an advancement game:
  // with advancement off the era floor never rises and the 48 exo tiles are
  // content nobody can reach. Mirrors the backend evaluator.
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

  // Mirrors the server rules: factions come from the shared pairing evaluator,
  // the seat count from the create route (galaxyPlayerCountRejection). The form
  // knows the seats it fills (host + AI) and the cap it asks for — four, or
  // eight for the Schism — so it can refuse the overflow before submitting;
  // humans can take the rest. Five or more on a four-seat lobby is a Schism the
  // host has not switched on, and says so.
  if (isGalactic) {
    const seats = input.player_count ?? 0;
    const cap = input.max_players ?? GALAXY_MAX_PLAYERS;
    if (!GALAXY_SEAT_COUNTS.includes(cap)) {
      return { allowed: false, hardBlock: GALAXY_PLAYER_COUNT_ERROR, warnings };
    }
    if (seats > cap) {
      const needsSchism = cap === GALAXY_MAX_PLAYERS && seats <= GALAXY_SCHISM_PLAYERS;
      return { allowed: false, hardBlock: needsSchism ? GALAXY_SCHISM_NEEDED_ERROR : GALAXY_PLAYER_COUNT_ERROR, warnings };
    }
    // Home Worlds off (galaxy_plain_lanes) plays without factions by design.
    if (settings.factions_enabled !== true && settings.galaxy_plain_lanes !== true) {
      return { allowed: false, hardBlock: GALAXY_FACTIONS_REQUIRED_ERROR, warnings };
    }
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

  const ascensionSpine = settings.era_advancement_spine_id === ASCENSION_GALAXY_SPINE_ID;
  if (settings.era_advancement_enabled === true && !ascensionSpine && era_id !== 'ancient') {
    return {
      allowed: false,
      hardBlock: 'Era Advancement requires Ancient rules — pick Ancient or disable Era Advancement',
      warnings,
    };
  }
  if (ascensionSpine && map_id !== ASCENSION_GALAXY_MAP_ID) {
    return {
      allowed: false,
      hardBlock: 'The Space to Stars climb needs the Space to Stars theater',
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

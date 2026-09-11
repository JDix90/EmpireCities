/**
 * Selectable eras and maps for lobby creation and in-lobby map-change votes.
 * Keep in sync with backend `lobbyMapChange.ts`.
 */

import { canAccessGalacticAge, GALACTIC_AGE_ERA_ID } from './galacticAgeAccess';

export const LOBBY_ERAS = [
  { id: 'ancient', label: 'Ancient World' },
  { id: 'medieval', label: 'Medieval Era' },
  { id: 'discovery', label: 'Age of Discovery' },
  { id: 'ww2', label: 'World War II' },
  { id: 'coldwar', label: 'Cold War' },
  { id: 'modern', label: 'The Modern Day' },
  { id: 'acw', label: 'American Civil War' },
  { id: 'risorgimento', label: 'Italian Unification' },
  { id: 'space_age', label: 'Space Age' },
  { id: 'galaxy_age', label: 'Galactic Age — Coming Soon' },
] as const;

/**
 * Space to Stars — one board that runs Space Age Earth + Moon and holds the
 * three Galactic Age worlds behind an era-advancement unlock. A THEATER, not a
 * rules era: it pairs with Space Age rules and needs Era Advancement on the
 * `space_to_stars` spine. Mirrors backend `lobbyMapChange.ts`.
 */
export const ASCENSION_GALAXY_MAP_ID = 'era_ascension_galaxy';
export const ASCENSION_GALAXY_START_ERA = 'space_age';
export const ASCENSION_GALAXY_SPINE_ID = 'space_to_stars';
export const ASCENSION_GALAXY_LABEL = 'Space to Stars';

/** True when this theater is the Space to Stars board. */
export function isAscensionGalaxyMap(mapId: string): boolean {
  return mapId === ASCENSION_GALAXY_MAP_ID;
}

export const LOBBY_ERA_MAP_IDS: Record<string, string> = {
  ancient: 'era_ancient',
  medieval: 'era_medieval',
  discovery: 'era_discovery',
  ww2: 'era_ww2',
  coldwar: 'era_coldwar',
  modern: 'era_modern',
  acw: 'era_acw',
  risorgimento: 'era_risorgimento',
  space_age: 'era_space_age',
  galaxy_age: 'era_galaxy',
};

/**
 * Eras eligible for Quick Match's random rotation: the seven "Global"
 * world maps. Regional theaters (ACW, Risorgimento) are excluded — they're
 * smaller-scope by design — and Galactic Age is admin-gated.
 */
export const QUICK_MATCH_ERAS = [
  'ancient',
  'medieval',
  'discovery',
  'ww2',
  'coldwar',
  'modern',
  'space_age',
] as const;
export type QuickMatchEra = (typeof QUICK_MATCH_ERAS)[number];

/**
 * Pool eras where a large share of the board sits behind an orbit gate.
 *
 * Space Age's nine lunar tiles are reached only through the Lunar Expansion
 * tech ladder plus a Launch Pad, and in the engine's own sims domination never
 * once completed there. A Quick Match whose chosen ending is "hold every
 * territory" therefore must not roll it, or the player's explicit choice would
 * be guaranteed to end on the turn cap instead. Endings that ask for a share of
 * the board (Blitz, Majority) and Capitals are all reachable on the Earth tiles,
 * so they keep the full rotation.
 */
export const ORBIT_GATED_QUICK_MATCH_ERAS: readonly QuickMatchEra[] = ['space_age'];

/** The rotation a Quick Match rolls from, narrowed when the ending needs the whole board. */
export function quickMatchEraPool(opts: { requiresFullBoard: boolean } = { requiresFullBoard: false }): readonly QuickMatchEra[] {
  if (!opts.requiresFullBoard) return QUICK_MATCH_ERAS;
  return QUICK_MATCH_ERAS.filter((era) => !ORBIT_GATED_QUICK_MATCH_ERAS.includes(era));
}

/** Random Quick Match era; `random` and the pool are injectable for tests. */
export function pickQuickMatchEra(
  random: () => number = Math.random,
  pool: readonly QuickMatchEra[] = QUICK_MATCH_ERAS,
): QuickMatchEra {
  const eras = pool.length > 0 ? pool : QUICK_MATCH_ERAS;
  const i = Math.min(eras.length - 1, Math.max(0, Math.floor(random() * eras.length)));
  return eras[i];
}

export const CURATED_COMMUNITY_MAP_IDS = [
  'community_14_nations',
  'community_strait_hormuz',
  'community_flooded_north_america',
  'community_charlemagne_814',
  'community_roman_empire_117',
  'community_mongol_empire',
  'community_napoleonic_europe',
  'community_sengoku_japan',
  'community_balkanized_usa',
  'community_fractured_china',
  'community_balkanized_india',
  'community_uncolonized_africa',
  'community_south_america',
  'community_divided_japan',
  'community_fractured_russia',
  'community_byzantium_megali',
  'community_balkanized_spain',
  'community_nusantara',
  'community_britain_925',
  'community_horn_africa',
  'community_australia_1337',
] as const;

export type LobbyMapChangeSelection = {
  era_id: string;
  map_id: string;
};

export function isLobbyMapChangeAllowed(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings) return true;
  if (settings.tutorial === true) return false;
  if (settings.is_campaign === true) return false;
  if (typeof settings.daily_challenge_date === 'string' && settings.daily_challenge_date.length > 0) {
    return false;
  }
  return true;
}

export function isCommunityTheaterMap(mapId: string): boolean {
  return (CURATED_COMMUNITY_MAP_IDS as readonly string[]).includes(mapId);
}

export function isEraSelectableInLobby(
  eraId: string,
  user: { is_admin?: boolean; is_guest?: boolean } | null | undefined,
): boolean {
  if (eraId === GALACTIC_AGE_ERA_ID) {
    return canAccessGalacticAge(user);
  }
  return eraId in LOBBY_ERA_MAP_IDS;
}

export function isSameMapSelection(
  current: { era_id: string; map_id: string },
  proposed: LobbyMapChangeSelection,
): boolean {
  return current.era_id === proposed.era_id && current.map_id === proposed.map_id;
}

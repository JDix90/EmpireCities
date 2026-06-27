/**
 * Selectable eras and maps for lobby creation and in-lobby map-change votes.
 * Keep in sync with backend `lobbyMapChange.ts`.
 */

import { getCustomMapImmersion } from '../data/customMapImmersion';
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

/** Random Quick Match era; `random` is injectable for tests. */
export function pickQuickMatchEra(random: () => number = Math.random): QuickMatchEra {
  const i = Math.min(QUICK_MATCH_ERAS.length - 1, Math.max(0, Math.floor(random() * QUICK_MATCH_ERAS.length)));
  return QUICK_MATCH_ERAS[i];
}

export const CURATED_COMMUNITY_MAP_IDS = [
  'community_14_nations',
  'community_strait_hormuz',
  'community_flooded_north_america',
  'community_charlemagne_814',
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

export function buildBuiltinMapSelection(eraId: string): LobbyMapChangeSelection {
  return {
    era_id: eraId,
    map_id: LOBBY_ERA_MAP_IDS[eraId] ?? eraId,
  };
}

export function buildCommunityMapSelection(mapId: string): LobbyMapChangeSelection {
  const immersion = getCustomMapImmersion(mapId);
  return {
    era_id: immersion?.recommended_rules_era ?? 'ancient',
    map_id: mapId,
  };
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

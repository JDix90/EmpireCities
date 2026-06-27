import { isSafeMapId } from '../../utils/mapId';

/** Built-in era → default map id (matches LobbyPage / game creation). */
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

export const LOBBY_ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'The Modern Day',
  acw: 'American Civil War',
  risorgimento: 'Italian Unification',
  space_age: 'Space Age',
  galaxy_age: 'Galactic Age',
};

/** Curated community / regional maps selectable in lobby (matches customMapImmersion). */
export const CURATED_COMMUNITY_MAP_IDS = new Set([
  'community_flooded_north_america',
  'community_charlemagne_814',
  'community_britain_925',
  'community_horn_africa',
  'community_australia_1337',
  'community_14_nations',
  'community_strait_hormuz',
]);

export const COMMUNITY_MAP_LABELS: Record<string, string> = {
  community_14_nations: 'The 14 Nations',
  community_strait_hormuz: 'Strait of Hormuz',
  community_flooded_north_america: 'Flooded North America',
  community_charlemagne_814: 'Europe — Death of Charlemagne, 814 A.D.',
  community_britain_925: 'Great Britain 925 A.D.',
  community_horn_africa: 'Horn of Africa & Yemen',
  community_australia_1337: 'Karkiyapani & Aotearoa 1337',
};

/** Rules-era ids allowed when pairing with a community map. */
export const LOBBY_RULES_ERA_IDS = new Set([
  'ancient',
  'medieval',
  'discovery',
  'ww2',
  'coldwar',
  'modern',
  'acw',
  'risorgimento',
  'space_age',
  'galaxy_age',
]);

export type LobbyMapChangeValue = {
  era_id: string;
  map_id: string;
};

export function parseLobbyMapChangeValue(value: unknown): LobbyMapChangeValue | null {
  if (typeof value !== 'object' || value == null) return null;
  const raw = value as Record<string, unknown>;
  const era_id = raw.era_id;
  const map_id = raw.map_id;
  if (typeof era_id !== 'string' || typeof map_id !== 'string') return null;
  if (!LOBBY_RULES_ERA_IDS.has(era_id)) return null;
  if (!isSafeMapId(map_id)) return null;
  return { era_id, map_id };
}

export function isBuiltinEraMapPair(eraId: string, mapId: string): boolean {
  return LOBBY_ERA_MAP_IDS[eraId] === mapId;
}

export function isCuratedCommunityMap(mapId: string): boolean {
  return CURATED_COMMUNITY_MAP_IDS.has(mapId);
}

export interface LobbyMapChangeContext {
  era_id: string;
  map_id: string;
  is_ranked: boolean;
  settings: Record<string, unknown>;
}

export function lobbyMapChangeBlockedReason(ctx: LobbyMapChangeContext): string | null {
  if (ctx.settings.tutorial === true) {
    return 'Map cannot be changed in tutorial games';
  }
  if (ctx.settings.is_campaign === true) {
    return 'Map cannot be changed in campaign games';
  }
  if (typeof ctx.settings.daily_challenge_date === 'string' && ctx.settings.daily_challenge_date.length > 0) {
    return 'Map cannot be changed in daily challenge games';
  }
  if (ctx.is_ranked) {
    return 'Map cannot be changed in ranked games';
  }
  return null;
}

export function isSameLobbyMap(
  current: { era_id: string; map_id: string },
  proposed: LobbyMapChangeValue,
): boolean {
  return current.era_id === proposed.era_id && current.map_id === proposed.map_id;
}

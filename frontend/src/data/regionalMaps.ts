/**
 * Regional Maps — Static metadata and loader for curated regional/alternate-history maps.
 * These maps ship with the client (in /public/maps/regional/) and don't require the backend API.
 */

import type { GameMap } from '../services/mapService';

export interface RegionalMapMeta {
  map_id: string;
  name: string;
  description: string;
  territory_count: number;
  region_count: number;
  icon: string;
  color: string;
  bgColor: string;
  year: string;
}

export const REGIONAL_MAPS: RegionalMapMeta[] = [
  {
    map_id: 'community_britain_925',
    name: 'Great Britain 925 A.D.',
    description:
      'Medieval Britain divided among Anglo-Saxon, Viking, Welsh, and Scottish kingdoms. Control England\'s heartland or unite the Celtic fringes to dominate the isles.',
    territory_count: 14,
    region_count: 5,
    icon: '🏰',
    color: '#8B4513',
    bgColor: '#1A1A2E',
    year: '925 AD',
  },
  {
    map_id: 'community_horn_africa',
    name: 'Horn of Africa & Yemen',
    description:
      'An alternate history: the Socialist Union of the Horn of Africa and Yemen. A unified federated state spanning Ethiopia, Somalia, Eritrea, Djibouti, and southern Yemen.',
    territory_count: 29,
    region_count: 5,
    icon: '🌍',
    color: '#E74C3C',
    bgColor: '#1C1210',
    year: 'Alt-History',
  },
  {
    map_id: 'community_australia_1337',
    name: 'Karkiyapani & Aotearoa 1337',
    description:
      'An alternate history depicting indigenous Australian nations as structured territorial states, plus Aotearoa (New Zealand) and Pacific Island polities.',
    territory_count: 26,
    region_count: 7,
    icon: '🦘',
    color: '#D4A017',
    bgColor: '#1A1510',
    year: '1337 AD',
  },
];

const mapCache = new Map<string, GameMap>();

/**
 * Fetch a regional map's full data from the public directory.
 * Results are cached in memory.
 */
export async function fetchRegionalMap(mapId: string): Promise<GameMap> {
  const cached = mapCache.get(mapId);
  if (cached) return cached;

  const resp = await fetch(`/maps/regional/${mapId}.json`);
  if (!resp.ok) throw new Error(`Failed to load regional map: ${mapId}`);

  const data: GameMap = await resp.json();
  mapCache.set(mapId, data);
  return data;
}

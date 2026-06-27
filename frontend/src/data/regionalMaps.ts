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
    map_id: 'community_charlemagne_814',
    name: 'Europe — Death of Charlemagne, 814 A.D.',
    description:
      'Europe at the death of Charlemagne in 814. The Frankish Empire towers over the continent, ringed by the Eastern Roman and Abbasid worlds, the Emirate of Córdoba, the Norse north, and a frontier of Slavic, Bulgar, Avar, Magyar, and Khazar peoples. Hold the Carolingian heartland or rise from the marches to inherit the empire.',
    territory_count: 46,
    region_count: 11,
    icon: '👑',
    color: '#70ad47',
    bgColor: '#10160E',
    year: '814 AD',
  },
  {
    map_id: 'community_flooded_north_america',
    name: 'Flooded North America',
    description:
      'A climate-collapse North America where inland seas and fractured coastlines redefine every front. Hold the surviving mountain arcs, bay citadels, and island corridors.',
    territory_count: 32,
    region_count: 6,
    icon: '🌊',
    color: '#5DADE2',
    bgColor: '#0E1A2B',
    year: 'Alt-2100',
  },
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

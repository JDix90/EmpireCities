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
    map_id: 'community_balkanized_usa',
    name: 'Balkanized United States',
    description:
      'The United States shattered into nine successor nations after the federal government dissolved — New England, the Mid-Atlantic, Dixie, Texas, Deseret, Cascadia, California, the Great Lakes, and the Plains. Borders follow the Mississippi, the Appalachians, the Rockies, and the old state lines.',
    territory_count: 36,
    region_count: 9,
    icon: '🦅',
    color: '#1F4E79',
    bgColor: '#0B1A2B',
    year: 'Alt-Present',
  },
  {
    map_id: 'community_fractured_china',
    name: 'Fractured China — Warlord Era',
    description:
      'China in the warlord era, splintered among nine cliques and frontier powers from Fengtian Manchuria to Tibet and the rich treaty ports of the Yangtze. Bridge the great rivers and seize the coast to reunify the Mandate of Heaven.',
    territory_count: 30,
    region_count: 9,
    icon: '🐉',
    color: '#C8102E',
    bgColor: '#0B1A2B',
    year: '1925',
  },
  {
    map_id: 'community_balkanized_india',
    name: 'Balkanized India',
    description:
      'The Indian subcontinent broken into nine successor states — Sikh Punjab, Hindustan, Bengal, the Dravidian south, the Maratha Deccan, Gujarat, Kashmir, Rajputana, and island Lanka. The Himalaya, the Ghats, the Thar, and two oceans draw the fronts.',
    territory_count: 33,
    region_count: 9,
    icon: '🐅',
    color: '#FF8A3D',
    bgColor: '#0B1A2B',
    year: 'Successor States',
  },
  {
    map_id: 'community_uncolonized_africa',
    name: 'Uncolonized Africa',
    description:
      "Africa on the eve of partition, whole and self-ruled: the caravan empires of the Sahel, Abyssinia's mountain kings, the Swahili coast, Kongo, Zimbabwe, and the Maghreb. Stake your claim from the Atlas to the Cape before the wider world arrives uninvited.",
    territory_count: 38,
    region_count: 8,
    icon: '🌍',
    color: '#C77B30',
    bgColor: '#0B1A2B',
    year: 'Age of Discovery',
  },
  {
    map_id: 'community_south_america',
    name: 'Balkanized South America',
    description:
      "South America fractured into six rival heirs of Bolívar's broken dream — Greater Argentina, Brazil, Gran Colombia, the Andean Federation, Chile, and Guaraní Paraguay — divided by the Andes, the Amazon, and the Plata.",
    territory_count: 34,
    region_count: 6,
    icon: '🌎',
    color: '#2E7D32',
    bgColor: '#0B1A2B',
    year: 'Age of Caudillos',
  },
  {
    map_id: 'community_divided_japan',
    name: 'Divided Japan & Korea',
    description:
      'An alternate 1946 where the Allies carve occupied Japan into Soviet, American, British, and Chinese zones while Korea splits at the 38th parallel. Every front is separated by water — the war is won in the straits.',
    territory_count: 27,
    region_count: 5,
    icon: '⛩️',
    color: '#BC002D',
    bgColor: '#0B1A2B',
    year: '1946',
  },
  {
    map_id: 'community_fractured_russia',
    name: 'Fractured Russia',
    description:
      'The largest country on Earth comes apart at the seams into eight successor states, from the Baltic littoral to the Pacific docks of Vladivostok. Rivers, the Urals, and the frozen Siberian frontier draw every contested border.',
    territory_count: 35,
    region_count: 8,
    icon: '❄️',
    color: '#3D5A80',
    bgColor: '#0B1A2B',
    year: 'Modern Collapse',
  },
  {
    map_id: 'community_byzantium_megali',
    name: 'Surviving Byzantium',
    description:
      'An alternate Byzantium that never fell: Constantinople still chains the Bosphorus while a battered Ottoman rump, Bulgaria, Serbia, the Latin islanders, and the Levantine ports fight for the straits and the wine-dark Aegean. Master the sea-lanes to master the empire.',
    territory_count: 33,
    region_count: 7,
    icon: '☦️',
    color: '#6A0DAD',
    bgColor: '#0B1A2A',
    year: 'Medieval Aegean',
  },
  {
    map_id: 'community_balkanized_spain',
    name: 'Balkanized Spain',
    description:
      'The Iberian Peninsula shattered along its old national and linguistic faults — Castile, Portugal, Andalusia, Catalonia, Aragon-Valencia, Galicia, the Basque Country, and Navarre. A compact theater of mountain frontiers and river borders where every neighbor is a rival crown.',
    territory_count: 24,
    region_count: 8,
    icon: '🐂',
    color: '#C60B1E',
    bgColor: '#1A0E0E',
    year: 'Fractured Iberia',
  },
  {
    map_id: 'community_nusantara',
    name: 'Maritime Southeast Asia',
    description:
      'The age of the spice routes, when Srivijaya and Majapahit ruled the sea-lanes. From the Strait of Malacca to the Banda Sea, fleets — not armies — decide who commands a thousand islands of pepper, cloves, and nutmeg.',
    territory_count: 34,
    region_count: 9,
    icon: '🌋',
    color: '#1CA3A3',
    bgColor: '#0B1A2B',
    year: 'Age of the Spice Winds',
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

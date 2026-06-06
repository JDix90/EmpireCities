import * as fs from 'fs';
import * as path from 'path';
import { getMapById } from '../modules/maps/mapService';
import { getTutorialMap } from '../game-engine/tutorial/tutorialScript';
import { isSafeMapId } from '../utils/mapId';
import type { GameMap } from '../types';

const CURATED_STATIC_REGIONAL_MAP_IDS = new Set<string>([
  'community_britain_925',
  'community_horn_africa',
  'community_australia_1337',
  'community_flooded_north_america',
  'era_galaxy',
]);

function loadMapFromDoc(mapDoc: Record<string, unknown>): GameMap {
  return {
    map_id: mapDoc.map_id as string,
    name: mapDoc.name as string,
    era: mapDoc.era as GameMap['era'],
    territories: mapDoc.territories as GameMap['territories'],
    connections: mapDoc.connections as GameMap['connections'],
    regions: mapDoc.regions as GameMap['regions'],
    canvas_width: mapDoc.canvas_width as number | undefined,
    canvas_height: mapDoc.canvas_height as number | undefined,
    projection_bounds: mapDoc.projection_bounds as GameMap['projection_bounds'],
    globe_view: mapDoc.globe_view as GameMap['globe_view'],
    map_kind: mapDoc.map_kind as GameMap['map_kind'],
    worlds: mapDoc.worlds as GameMap['worlds'],
    orbit_access: mapDoc.orbit_access as GameMap['orbit_access'],
  };
}

/** Resolve a map id to a GameMap (tutorial, DB, or static JSON). */
export async function resolveMap(mapId: string): Promise<GameMap | null> {
  if (mapId === 'tutorial') return getTutorialMap();
  if (CURATED_STATIC_REGIONAL_MAP_IDS.has(mapId)) {
    if (!isSafeMapId(mapId)) return null;
    const curatedPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);
    if (fs.existsSync(curatedPath)) {
      const data = JSON.parse(fs.readFileSync(curatedPath, 'utf-8'));
      return loadMapFromDoc(data);
    }
    return null;
  }
  const mapFromDb = await getMapById(mapId);
  if (mapFromDb) return mapFromDb;

  if (!isSafeMapId(mapId)) return null;
  const jsonPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return loadMapFromDoc(data);
  }
  return null;
}

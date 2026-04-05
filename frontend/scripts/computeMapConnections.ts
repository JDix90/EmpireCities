/**
 * Regenerates `connections` in database/maps/*.json from globe geometry:
 * land edges = Turf booleanTouches on the same merged GeoJSON GlobeMap uses.
 * Sea edges from the previous file are kept when still valid (no duplicate land pair).
 *
 * Run from repo: pnpm -C frontend exec tsx scripts/computeMapConnections.ts
 * Requires network once to fetch Natural Earth admin-0 + admin-1 (same URLs as GlobeMap).
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { booleanTouches } from '@turf/boolean-touches';
import booleanIntersects from '@turf/boolean-intersects';
import buffer from '@turf/buffer';
import { feature } from '@turf/helpers';
import { buildTerritoryGlobeGeometries } from '../src/utils/globeTerritoryGeometry';
import type { GameMap, Connection } from '../src/services/mapService';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';
const STATES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_1_states_provinces.geojson';

const MAPS_DIR = join(__dirname, '../../database/maps');
const RISORGIMENTO_PATH = join(__dirname, '../public/geo/risorgimento_admin1.json');
const STRAIT_HORMUZ_PATH = join(__dirname, '../public/geo/strait_hormuz_admin1.json');

function sortedPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * NE 110m/10m polygons often have micro-gaps at shared borders; pure booleanTouches misses those.
 * Small symmetric buffer then intersect detects land adjacency without bridging oceans (e.g. Channel).
 */
function geometriesAreLandAdjacent(
  ga: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  gb: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
  const fa = feature(ga);
  const fb = feature(gb);
  try {
    if (booleanTouches(fa, fb)) return true;
  } catch {
    /* invalid ring */
  }
  try {
    const ba = buffer(fa, 0.85, { units: 'kilometers' });
    const bb = buffer(fb, 0.85, { units: 'kilometers' });
    const gba = ba.geometry;
    const gbb = bb.geometry;
    if (!gba || !gbb || (gba.type !== 'Polygon' && gba.type !== 'MultiPolygon')) return false;
    if (!gbb || (gbb.type !== 'Polygon' && gbb.type !== 'MultiPolygon')) return false;
    return booleanIntersects(feature(gba), feature(gbb));
  } catch {
    return false;
  }
}

async function loadGeo(): Promise<{
  countriesGeo: GeoJSON.FeatureCollection;
  statesGeo: GeoJSON.FeatureCollection;
  risorgimentoGeo: GeoJSON.FeatureCollection;
  straitHormuzGeo: GeoJSON.FeatureCollection;
}> {
  const [countriesRes, statesRes] = await Promise.all([
    fetch(COUNTRIES_GEOJSON_URL),
    fetch(STATES_GEOJSON_URL),
  ]);
  if (!countriesRes.ok) throw new Error(`Countries fetch failed: ${countriesRes.status}`);
  if (!statesRes.ok) throw new Error(`States fetch failed: ${statesRes.status}`);
  const countriesGeo = (await countriesRes.json()) as GeoJSON.FeatureCollection;
  const statesGeo = (await statesRes.json()) as GeoJSON.FeatureCollection;
  const risorgimentoGeo = JSON.parse(
    readFileSync(RISORGIMENTO_PATH, 'utf8'),
  ) as GeoJSON.FeatureCollection;
  const straitHormuzGeo = JSON.parse(
    readFileSync(STRAIT_HORMUZ_PATH, 'utf8'),
  ) as GeoJSON.FeatureCollection;
  return { countriesGeo, statesGeo, risorgimentoGeo, straitHormuzGeo };
}

function computeLandConnections(
  map: GameMap,
  inputs: {
    countriesGeo: GeoJSON.FeatureCollection;
    statesGeo: GeoJSON.FeatureCollection;
    risorgimentoGeo: GeoJSON.FeatureCollection;
    straitHormuzGeo: GeoJSON.FeatureCollection;
  },
): Set<string> {
  const needsRis =
    map.map_id === 'era_risorgimento' ||
    map.territories.some((t) => t.territory_id.startsWith('ris_'));

  const needsStraitHormuz =
    map.map_id === 'community_strait_hormuz' ||
    map.territories.some((t) => t.territory_id.startsWith('hz_'));

  const polygons = buildTerritoryGlobeGeometries(map, {
    countriesGeo: inputs.countriesGeo,
    statesGeo: inputs.statesGeo,
    risorgimentoGeo: needsRis ? inputs.risorgimentoGeo : { type: 'FeatureCollection', features: [] },
    admin50Geo: null,
    straitHormuzGeo: needsStraitHormuz ? inputs.straitHormuzGeo : null,
  });

  const land = new Set<string>();
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const a = polygons[i];
      const b = polygons[j];
      if (geometriesAreLandAdjacent(a.geometry, b.geometry)) {
        land.add(sortedPairKey(a.territory_id, b.territory_id));
      }
    }
  }
  return land;
}

function mergeConnections(
  map: GameMap,
  landKeys: Set<string>,
): Connection[] {
  const ids = new Set(map.territories.map((t) => t.territory_id));
  const out: Connection[] = [];

  for (const k of landKeys) {
    const [a, b] = k.split('|');
    out.push({ from: a, to: b, type: 'land' });
  }

  for (const c of map.connections) {
    if (c.type !== 'sea') continue;
    if (!ids.has(c.from) || !ids.has(c.to)) continue;
    const k = sortedPairKey(c.from, c.to);
    if (landKeys.has(k)) continue;
    out.push({ ...c });
  }

  out.sort((x, y) => {
    const s = x.from.localeCompare(y.from);
    return s !== 0 ? s : x.to.localeCompare(y.to);
  });
  return out;
}

async function main(): Promise<void> {
  const inputs = await loadGeo();
  const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));

  for (const name of files) {
    const path = join(MAPS_DIR, name);
    const map = JSON.parse(readFileSync(path, 'utf8')) as GameMap;
    const landKeys = computeLandConnections(map, inputs);
    const connections = mergeConnections(map, landKeys);
    map.connections = connections;
    writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`);
    console.log(
      name,
      'territories:',
      map.territories.length,
      'land pairs:',
      landKeys.size,
      'connections:',
      connections.length,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

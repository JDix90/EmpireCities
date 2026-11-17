import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import turfArea from '@turf/area';
import buffer from '@turf/buffer';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { feature, point } from '@turf/helpers';
import { intersection } from 'polyclip-ts';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';
import { signedLngLatRingArea } from './galaxyOrganicGlobeRing';
import { CURATED_COMMUNITY_MAP_IDS } from '../constants/lobbyMapOptions';
import { REGIONAL_MAPS } from '../data/regionalMaps';
import { getCustomMapImmersion } from '../data/customMapImmersion';

/**
 * The 14 Nations (`community_fourteen_nations`) as the globe and the 2D map
 * draw it, through the same builder, from the committed map and its outline
 * file (database/maps/build_fourteen_nations.py).
 *
 * Its predecessor (`community_14_nations`) was 43 territories in 8 regions cut
 * along state and provincial lines, with lore about megacities and tech
 * campuses. The rebuild draws every border from a river, a crest or a divide.
 * These checks keep it honest: every territory draws from its own outline,
 * every town is in the territory named for it, nothing overlaps, every land
 * link joins territories that touch, and no territory is too wide for the
 * globe to draw flat.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf-8'));

type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;
interface MapJson {
  map_id: string;
  territories: { territory_id: string; admin1: string[]; geo_polygon: [number, number][]; region_id: string }[];
  connections: { from: string; to: string; type: 'land' | 'sea' }[];
  regions: { region_id: string; territory_ids: string[] }[];
}

/** Real places and the territory each must fall in ([lng, lat]; coastal towns a little inland of the board's coastline). */
const PLACES: [string, [number, number], string][] = [
  ['Sitka', [-135.33, 57.09], 'lingit'],
  ['Ketchikan', [-131.64, 55.34], 'lingit'],
  ['Skidegate', [-132.01, 53.29], 'lingit'],
  ['Prince Rupert', [-130.32, 54.31], 'wakashan'],
  ['Bella Coola', [-126.75, 52.37], 'wakashan'],
  ['Port Hardy', [-127.42, 50.7], 'wakashan'],
  ['Seattle', [-122.33, 47.61], 'coast_salish'],
  ['Victoria', [-123.37, 48.43], 'coast_salish'],
  ['Vancouver', [-123.1, 49.26], 'coast_salish'],
  ['Kamloops', [-120.33, 50.67], 'interior_salish'],
  ['Kelowna', [-119.5, 49.89], 'interior_salish'],
  ['Spokane', [-117.42, 47.66], 'interior_salish'],
  ['Yakima', [-120.51, 46.6], 'sahaptin'],
  ['Walla Walla', [-118.34, 46.06], 'sahaptin'],
  ['Lewiston', [-117.02, 46.42], 'sahaptin'],
  ['Eureka', [-124.16, 40.8], 'yurok_pomo'],
  ['Redding', [-122.39, 40.59], 'yurok_pomo'],
  ['Ukiah', [-123.21, 39.15], 'yurok_pomo'],
  ['San Francisco', [-122.42, 37.77], 'ohlone_yokuts'],
  ['Sacramento', [-121.49, 38.58], 'ohlone_yokuts'],
  ['Fresno', [-119.79, 36.74], 'ohlone_yokuts'],
  ['Santa Barbara', [-119.7, 34.43], 'chumash_kumeyaay'],
  ['Los Angeles', [-118.24, 34.05], 'chumash_kumeyaay'],
  ['San Diego', [-117.13, 32.73], 'chumash_kumeyaay'],
  ['La Paz', [-110.31, 24.14], 'cochimi'],
  ['Loreto', [-111.36, 26.01], 'cochimi'],
  ['Guerrero Negro', [-114.04, 27.97], 'cochimi'],
  ['Reno', [-119.81, 39.53], 'numu'],
  ['Burns', [-119.05, 43.59], 'numu'],
  ['Winnemucca', [-117.74, 40.97], 'numu'],
  ['Las Vegas', [-115.14, 36.17], 'nuwuvi'],
  ['St. George', [-113.58, 37.1], 'nuwuvi'],
  ['Bishop', [-118.4, 37.36], 'nuwuvi'],
  ['Boise', [-116.2, 43.62], 'newe'],
  ['Pocatello', [-112.45, 42.87], 'newe'],
  ['Salt Lake City', [-111.89, 40.76], 'newe'],
  ['Provo', [-111.66, 40.23], 'nuuchiu'],
  ['Grand Junction', [-108.55, 39.06], 'nuuchiu'],
  ['Durango', [-107.88, 37.27], 'nuuchiu'],
  ['Amarillo', [-101.83, 35.22], 'comanche'],
  ['Lubbock', [-101.85, 33.58], 'comanche'],
  ['Dodge City', [-100.02, 37.75], 'comanche'],
  ['San Antonio', [-98.49, 29.42], 'penateka'],
  ['Corpus Christi', [-97.5, 27.8], 'penateka'],
  ['Laredo', [-99.5, 27.53], 'penateka'],
  ['Flagstaff', [-111.65, 35.2], 'dine'],
  ['Window Rock', [-109.05, 35.68], 'dine'],
  ['Chinle', [-109.55, 36.15], 'dine'],
  ['Santa Fe', [-105.94, 35.69], 'pueblo'],
  ['Albuquerque', [-106.65, 35.08], 'pueblo'],
  ['Taos', [-105.57, 36.41], 'pueblo'],
  ['Tucson', [-110.97, 32.22], 'oodham'],
  ['Phoenix', [-112.07, 33.45], 'oodham'],
  ['Hermosillo', [-110.96, 29.07], 'oodham'],
  ['Ciudad Obregón', [-109.93, 27.48], 'yoeme'],
  ['Culiacán', [-107.39, 24.8], 'yoeme'],
  ['Los Mochis', [-108.99, 25.79], 'yoeme'],
  ['Las Cruces', [-106.78, 32.32], 'nde'],
  ['Chihuahua', [-106.08, 28.63], 'nde'],
  ['Silver City', [-108.28, 32.77], 'nde'],
  ['Mexico City', [-99.13, 19.43], 'anahuac'],
  ['Puebla', [-98.2, 19.04], 'anahuac'],
  ['Toluca', [-99.66, 19.29], 'anahuac'],
  ['Tampico', [-97.95, 22.25], 'huasteca'],
  ['Veracruz', [-96.2, 19.15], 'huasteca'],
  ['Xalapa', [-96.92, 19.54], 'huasteca'],
  ['Oaxaca', [-96.73, 17.06], 'oaxaca'],
  ['Acapulco', [-99.85, 16.9], 'oaxaca'],
  ['Juchitán', [-95.02, 16.43], 'oaxaca'],
  ['Morelia', [-101.19, 19.7], 'purepecha'],
  ['Guadalajara', [-103.35, 20.67], 'purepecha'],
  ['Colima', [-103.72, 19.24], 'purepecha'],
  ['Zacatecas', [-102.57, 22.77], 'chichimeca'],
  ['San Luis Potosí', [-100.98, 22.15], 'chichimeca'],
  ['Durango', [-104.67, 24.02], 'chichimeca'],
  ['Monterrey', [-100.31, 25.67], 'coahuila'],
  ['Saltillo', [-101.0, 25.42], 'coahuila'],
  ['Torreón', [-103.41, 25.54], 'coahuila'],
  ['Mérida', [-89.62, 20.97], 'mayapan'],
  ['Campeche', [-90.45, 19.82], 'mayapan'],
  ['Cancún', [-86.9, 21.1], 'mayapan'],
  ['Villahermosa', [-92.93, 17.99], 'peten'],
  ['Flores', [-89.89, 16.93], 'peten'],
  ['Belize City', [-88.3, 17.5], 'peten'],
  ['Guatemala City', [-90.51, 14.63], 'kiche'],
  ['Quetzaltenango', [-91.52, 14.84], 'kiche'],
  ['San Cristóbal de las Casas', [-92.64, 16.74], 'kiche'],
  ['Rapid City', [-103.23, 44.08], 'lakota'],
  ['Gillette', [-105.5, 44.29], 'lakota'],
  ['Dickinson', [-102.79, 46.88], 'lakota'],
  ['Sioux Falls', [-96.73, 43.55], 'dakota'],
  ['Minneapolis', [-93.27, 44.98], 'dakota'],
  ['Aberdeen', [-98.49, 45.46], 'dakota'],
  ['Regina', [-104.62, 50.45], 'nakota'],
  ['Brandon', [-99.95, 49.85], 'nakota'],
  ['Minot', [-101.3, 48.23], 'nakota'],
  ['Billings', [-108.5, 45.78], 'apsaalooke'],
  ['Sheridan', [-106.96, 44.8], 'apsaalooke'],
  ['Cody', [-109.06, 44.53], 'apsaalooke'],
  ['Calgary', [-114.07, 51.05], 'niitsitapi'],
  ['Lethbridge', [-112.84, 49.69], 'niitsitapi'],
  ['Red Deer', [-113.81, 52.27], 'niitsitapi'],
  ['Fort McMurray', [-111.38, 56.73], 'nehiyaw'],
  ['La Ronge', [-105.28, 55.1], 'nehiyaw'],
  ['Athabasca', [-113.29, 54.72], 'nehiyaw'],
  ['Thompson', [-97.85, 55.74], 'maskekowak'],
  ['Norway House', [-97.84, 53.98], 'maskekowak'],
  ['Island Lake', [-94.65, 53.86], 'maskekowak'],
  ['Fort Albany', [-81.67, 52.2], 'omushkego'],
  ['Attawapiskat', [-82.6, 52.9], 'omushkego'],
  ['Peawanuck', [-85.43, 54.99], 'omushkego'],
  ['Waskaganish', [-78.7, 51.48], 'eeyou'],
  ['Wemindji', [-78.7, 53.0], 'eeyou'],
  ['Nemaska', [-76.24, 51.69], 'eeyou'],
  ['Thunder Bay', [-89.25, 48.38], 'ojibwe'],
  ['Marquette', [-87.4, 46.55], 'ojibwe'],
  ['Sault Ste. Marie', [-84.35, 46.48], 'ojibwe'],
  ['Bemidji', [-94.88, 47.47], 'saulteaux'],
  ['Duluth', [-92.12, 46.79], 'saulteaux'],
  ['Kenora', [-94.47, 49.79], 'saulteaux'],
  ['Lansing', [-84.55, 42.73], 'odawa'],
  ['Traverse City', [-85.62, 44.76], 'odawa'],
  ['Flint', [-83.69, 43.01], 'odawa'],
  ['Chicago', [-87.65, 41.88], 'potawatomi'],
  ['Milwaukee', [-87.93, 43.04], 'potawatomi'],
  ['Madison', [-89.4, 43.07], 'potawatomi'],
  ['Ottawa', [-75.7, 45.42], 'algonquin'],
  ['North Bay', [-79.46, 46.31], 'algonquin'],
  ['Pembroke', [-77.12, 45.83], 'algonquin'],
  ['Utica', [-75.23, 43.1], 'kanienkehaka'],
  ['Lake Placid', [-73.98, 44.28], 'kanienkehaka'],
  ['Schenectady', [-73.94, 42.81], 'kanienkehaka'],
  ['Syracuse', [-76.15, 43.05], 'onondaga_seneca'],
  ['Rochester', [-77.61, 43.16], 'onondaga_seneca'],
  ['Batavia', [-78.19, 43.0], 'onondaga_seneca'],
  ['Harrisburg', [-76.88, 40.27], 'susquehannock'],
  ['Williamsport', [-77.0, 41.24], 'susquehannock'],
  ['State College', [-77.86, 40.79], 'susquehannock'],
  ['Toronto', [-79.38, 43.68], 'wendake'],
  ['London', [-81.25, 42.98], 'wendake'],
  ['Barrie', [-79.69, 44.39], 'wendake'],
  ['Saguenay', [-71.07, 48.43], 'nitassinan'],
  ['Sept-Îles', [-66.5, 50.25], 'nitassinan'],
  ['Quebec City', [-71.25, 46.82], 'nitassinan'],
  ['Halifax', [-63.62, 44.67], 'mikmaq'],
  ['Moncton', [-64.78, 46.09], 'mikmaq'],
  ['Gaspé', [-64.55, 48.85], 'mikmaq'],
  ['Portland, Maine', [-70.28, 43.67], 'wabanaki'],
  ['Boston', [-71.08, 42.36], 'wabanaki'],
  ['Burlington', [-73.2, 44.48], 'wabanaki'],
  ['Philadelphia', [-75.17, 39.95], 'lenape_powhatan'],
  ['New York', [-73.97, 40.78], 'lenape_powhatan'],
  ['Richmond', [-77.44, 37.54], 'lenape_powhatan'],
  ['Cahokia Mounds', [-90.06, 38.66], 'cahokia'],
  ['St. Louis', [-90.25, 38.63], 'cahokia'],
  ['Springfield, Illinois', [-89.65, 39.8], 'cahokia'],
  ['Columbus', [-82.99, 39.96], 'ohio_valley'],
  ['Cincinnati', [-84.51, 39.15], 'ohio_valley'],
  ['Indianapolis', [-86.16, 39.77], 'ohio_valley'],
  ['Nashville', [-86.78, 36.16], 'tennessee_cumberland'],
  ['Lexington', [-84.5, 38.04], 'tennessee_cumberland'],
  ['Louisville', [-85.76, 38.2], 'tennessee_cumberland'],
  ['Natchez', [-91.4, 31.56], 'natchez'],
  ['Greenville', [-91.06, 33.41], 'natchez'],
  ['Helena', [-90.59, 34.53], 'natchez'],
  ['Asheville', [-82.55, 35.6], 'ani_yunwiya'],
  ['Knoxville', [-83.92, 35.96], 'ani_yunwiya'],
  ['Columbia, South Carolina', [-81.03, 34.0], 'ani_yunwiya'],
  ['Montgomery', [-86.3, 32.37], 'muscogee'],
  ['Macon', [-83.63, 32.84], 'muscogee'],
  ['Atlanta', [-84.39, 33.75], 'muscogee'],
  ['Jackson', [-90.18, 32.3], 'chahta_chikasha'],
  ['Tupelo', [-88.7, 34.26], 'chahta_chikasha'],
  ['Hattiesburg', [-89.29, 31.33], 'chahta_chikasha'],
  ['Gainesville', [-82.32, 29.65], 'timucua_calusa'],
  ['Orlando', [-81.38, 28.54], 'timucua_calusa'],
  ['Miami', [-80.3, 25.8], 'timucua_calusa'],
  ['Nacogdoches', [-94.66, 31.6], 'hasinai'],
  ['Texarkana', [-94.05, 33.43], 'hasinai'],
  ['Shreveport', [-93.75, 32.5], 'hasinai'],
  ['Wichita', [-97.34, 37.69], 'wichita'],
  ['Oklahoma City', [-97.52, 35.47], 'wichita'],
  ['Tulsa', [-95.99, 36.15], 'wichita'],
  ['Lincoln', [-96.7, 40.81], 'pawnee'],
  ['Grand Island', [-98.34, 40.92], 'pawnee'],
  ['North Platte', [-100.77, 41.12], 'pawnee'],
];

const parts = (g: Geom): GeoJSON.Position[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/** Great-circle distance in degrees. */
function arcDeg([lng1, lat1]: GeoJSON.Position, [lng2, lat2]: GeoJSON.Position): number {
  const r = Math.PI / 180;
  const c =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return Math.acos(Math.min(1, c)) / r;
}

function bbox(g: Geom): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90];
  for (const poly of parts(g)) for (const [x, y] of poly[0]) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

describe('The 14 Nations (community_fourteen_nations)', () => {
  const map = read('../../../database/maps/community_fourteen_nations.json') as MapJson;
  const subset = read('../../public/geo/fourteen_nations_admin1.json') as GeoJSON.FeatureCollection;
  let geoms: Map<string, Geom>;

  beforeAll(() => {
    const countriesGeo = read('../../public/geo/ne_50m_admin_0_countries.json') as GeoJSON.FeatureCollection;
    const built = buildTerritoryGlobeGeometries(map as never, {
      countriesGeo,
      statesGeo: null,
      risorgimentoGeo: null,
      regionalAdmin1Geo: subset,
    });
    geoms = new Map(built.map((p) => [p.territory_id, p.geometry as Geom]));
  });

  it('is fourteen nations of at least three territories each', () => {
    expect(map.regions).toHaveLength(14);
    for (const r of map.regions) expect(r.territory_ids.length, r.region_id).toBeGreaterThanOrEqual(3);
    expect(map.territories).toHaveLength(62);
  });

  it('draws every territory from its own outline, never the fallback', () => {
    const byCode = new Map(subset.features.map((f) => [f.properties!.iso_3166_2 as string, f.geometry as Geom]));
    for (const t of map.territories) {
      expect(t.admin1, t.territory_id).toHaveLength(1);
      const own = byCode.get(t.admin1[0]);
      expect(own, `${t.territory_id}: ${t.admin1[0]} missing from the outline file`).toBeTruthy();
      const expected = turfArea(feature(own!));
      const drawn = turfArea(feature(geoms.get(t.territory_id)!));
      expect(Math.abs(drawn - expected) / expected, t.territory_id).toBeLessThan(0.01);
    }
  });

  it('winds every exterior ring the way the globe fills it, or it draws as shards', () => {
    // d3-geo reads a counter-clockwise exterior as the polygon's complement
    // (globeTerritoryGeometry.regional.test.ts); a single-code territory reaches
    // the globe exactly as the outline file stores it, with no union to rewind it.
    const ccw: string[] = [];
    for (const [id, g] of geoms) {
      parts(g).forEach((poly, i) => {
        if (signedLngLatRingArea(poly[0].slice(0, -1) as [number, number][]) <= 0) ccw.push(`${id}[${i}]`);
      });
    }
    expect(ccw).toEqual([]);
  });

  it('keeps no territory too wide for the globe to draw its cap flat', () => {
    // Regional boards draw caps unsubdivided (polygonCapCurvatureResolution 360
    // in GlobeMap), so a cap much over a dozen degrees across sinks into the sea.
    const wide: string[] = [];
    for (const [id, g] of geoms) {
      for (const poly of parts(g)) {
        const ring = poly[0];
        let span = 0;
        for (let i = 0; i < ring.length; i += 1) for (let j = i + 1; j < ring.length; j += 1) span = Math.max(span, arcDeg(ring[i], ring[j]));
        if (span > 13) wide.push(`${id}: ${span.toFixed(1)}°`);
      }
    }
    expect(wide).toEqual([]);
  });

  it('keeps a real outline as the fallback, should the outline file not load', () => {
    for (const t of map.territories) {
      expect(t.geo_polygon.length, t.territory_id).toBeGreaterThanOrEqual(8);
      const largest = Math.max(...parts(geoms.get(t.territory_id)!).map((poly) => turfArea({ type: 'Polygon', coordinates: poly })));
      const outline = turfArea({ type: 'Polygon', coordinates: [[...t.geo_polygon, t.geo_polygon[0]]] });
      expect(outline / largest, t.territory_id).toBeGreaterThan(0.8);
      expect(outline / largest, t.territory_id).toBeLessThan(1.25);
    }
  });

  it('puts every town in the territory named for it', () => {
    const wrong: string[] = [];
    for (const [place, lngLat, expected] of PLACES) {
      const inside = [...geoms].filter(([, g]) => booleanPointInPolygon(point(lngLat), feature(g))).map(([id]) => id);
      if (inside.length !== 1 || inside[0] !== expected) wrong.push(`${place}: expected ${expected}, in [${inside.join(', ')}]`);
    }
    expect(wrong).toEqual([]);
    expect(new Set(PLACES.map(([, , t]) => t)).size).toBe(map.territories.length);
  });

  it('never draws two territories over each other', () => {
    const ids = [...geoms.keys()];
    const boxes = new Map(ids.map((id) => [id, bbox(geoms.get(id)!)]));
    const overlaps: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const [a, b] = [boxes.get(ids[i])!, boxes.get(ids[j])!];
        if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
        const inter = intersection(geoms.get(ids[i])!.coordinates as never, geoms.get(ids[j])!.coordinates as never) as unknown as GeoJSON.Position[][][];
        const km2 = inter.length ? turfArea({ type: 'MultiPolygon', coordinates: inter }) / 1e6 : 0;
        if (km2 > 0.5) overlaps.push(`${ids[i]} × ${ids[j]}: ${km2.toFixed(1)} km²`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('joins by land only territories whose land touches, and every territory is reachable', () => {
    const apart: string[] = [];
    for (const c of map.connections.filter((x) => x.type === 'land')) {
      const near = buffer(feature(geoms.get(c.from)!), 0.5, { units: 'kilometers' })!;
      const inter = intersection(near.geometry.coordinates as never, geoms.get(c.to)!.coordinates as never) as unknown as unknown[];
      if (inter.length === 0) apart.push(`${c.from} — ${c.to}`);
    }
    expect(apart).toEqual([]);

    const adj = new Map<string, string[]>();
    for (const c of map.connections) {
      adj.set(c.from, [...(adj.get(c.from) ?? []), c.to]);
      adj.set(c.to, [...(adj.get(c.to) ?? []), c.from]);
    }
    const seen = new Set<string>(['cahokia']);
    const queue = ['cahokia'];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    expect(seen.size).toBe(map.territories.length);
  });

  it('is offered in the lobby and the map hub in place of the map it replaces, with its own lore', () => {
    expect(CURATED_COMMUNITY_MAP_IDS).toContain('community_fourteen_nations');
    expect(CURATED_COMMUNITY_MAP_IDS).not.toContain('community_14_nations');
    expect(REGIONAL_MAPS.map((m) => m.map_id)).toContain('community_fourteen_nations');
    expect(REGIONAL_MAPS.map((m) => m.map_id)).not.toContain('community_14_nations');
    const hub = REGIONAL_MAPS.find((m) => m.map_id === 'community_fourteen_nations')!;
    expect(hub.territory_count).toBe(map.territories.length);
    expect(hub.region_count).toBe(map.regions.length);
    const lore = getCustomMapImmersion('community_fourteen_nations')!;
    expect(lore.recommended_rules_era).toBe('discovery');
    expect(JSON.stringify(lore)).not.toMatch(/manifest destiny|megacity|tech campus|superpower/i);
  });
});

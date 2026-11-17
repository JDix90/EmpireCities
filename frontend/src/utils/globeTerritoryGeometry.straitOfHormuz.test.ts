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

/**
 * The Strait of Hormuz (`community_strait_of_hormuz`) as the globe and the 2D
 * map draw it, through the same builder, from the committed map and its
 * admin-1 subset (frontend/scripts/buildStraitOfHormuz.ts).
 *
 * Its predecessor (`community_strait_hormuz`) clipped provinces to a
 * one-degree grid: three territories fell back to rectangles in open sea, two
 * of them over Bahrain and Qatar, 40% of the land in its bounds belonged to no
 * one, and Bandar Abbas, Hormuz Island, Abu Dhabi city, Sohar and Ras
 * al-Khaimah lay outside the territories named for them. These checks keep the
 * rebuild honest: every territory draws from real provinces, every town is in
 * the territory named for it, no two territories overlap, and every land link
 * joins territories that touch.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf-8'));

type Geom = GeoJSON.Polygon | GeoJSON.MultiPolygon;
interface MapJson {
  map_id: string;
  territories: { territory_id: string; admin1: string[] }[];
  connections: { from: string; to: string; type: 'land' | 'sea' }[];
}

/** Real places and the territory each must fall in ([lng, lat]; coastal towns a little inland of Natural Earth's coastline). */
const PLACES: [string, [number, number], string][] = [
  ['Bushehr', [50.84, 28.95], 'bushehr'],
  ['Borazjan', [51.21, 29.27], 'bushehr'],
  ['Kharg Island', [50.32, 29.24], 'bushehr'],
  ['Kangan', [52.07, 27.83], 'kangan'],
  ['Asaluyeh', [52.64, 27.49], 'kangan'],
  ['Dayyer', [51.95, 27.84], 'kangan'],
  ['Firuzabad', [52.57, 28.84], 'firuzabad'],
  ['Jahrom', [53.56, 28.5], 'firuzabad'],
  ['Lar', [54.34, 27.68], 'larestan'],
  ['Lamerd', [53.18, 27.34], 'larestan'],
  ['Bandar Lengeh', [54.88, 26.57], 'bandar_lengeh'],
  ['Bastak', [54.37, 27.2], 'bandar_lengeh'],
  ['Bandar Abbas', [56.28, 27.21], 'bandar_abbas'],
  ['Khamir', [55.58, 26.95], 'bandar_abbas'],
  ['Hajiabad', [55.9, 28.31], 'bandar_abbas'],
  ['Minab', [57.08, 27.15], 'minab'],
  ['Rudan', [57.19, 27.44], 'minab'],
  ['Jask', [57.79, 25.66], 'jask'],
  ['Chabahar', [60.64, 25.3], 'chabahar'],
  ['Konarak', [60.45, 25.45], 'chabahar'],
  ['Qeshm island', [55.85, 26.8], 'qeshm'],
  ['Hormuz Island', [56.46, 27.07], 'qeshm'],
  ['Larak', [56.36, 26.86], 'qeshm'],
  ['Kish', [53.98, 26.53], 'kish'],
  ['Lavan', [53.27, 26.82], 'kish'],
  ['Abu Musa', [55.03, 25.88], 'abu_musa'],
  ['Greater Tunb', [55.305, 26.265], 'abu_musa'],
  ['Sirri', [54.53, 25.91], 'abu_musa'],
  ['Abu Dhabi', [54.4, 24.47], 'abu_dhabi'],
  ['Ruwais', [52.73, 24.08], 'al_dhafra'],
  ['Madinat Zayed', [53.7, 23.68], 'al_dhafra'],
  ['Liwa', [53.76, 23.12], 'al_dhafra'],
  ['Al Ain', [55.76, 24.21], 'al_ain'],
  ['Dubai', [55.3, 25.2], 'dubai'],
  ['Hatta', [56.13, 24.8], 'dubai'],
  ['Sharjah', [55.42, 25.33], 'sharjah'],
  ['Ajman', [55.47, 25.4], 'sharjah'],
  ['Umm al-Quwain', [55.6, 25.52], 'sharjah'],
  ['Khor Fakkan', [56.33, 25.34], 'sharjah'],
  ['Kalba', [56.34, 25.06], 'sharjah'],
  ['Ras al-Khaimah', [55.97, 25.78], 'ras_al_khaimah'],
  ['Fujairah', [56.32, 25.12], 'fujairah'],
  ['Manama', [50.58, 26.22], 'bahrain'],
  ['Doha', [51.5, 25.28], 'qatar'],
  ['Al Khor', [51.48, 25.68], 'qatar'],
  ['Dammam', [50.08, 26.42], 'dammam'],
  ['Qatif', [49.99, 26.55], 'dammam'],
  ['Jubail', [49.64, 27.0], 'dammam'],
  ['Hofuf', [49.59, 25.38], 'al_ahsa'],
  ['Shaybah', [54.0, 22.51], 'empty_quarter'],
  ['Khasab', [56.25, 26.18], 'musandam'],
  ['Madha', [56.31, 25.28], 'musandam'],
  ['Sohar', [56.72, 24.35], 'sohar'],
  ['Shinas', [56.45, 24.73], 'sohar'],
  ['Rustaq', [57.42, 23.39], 'rustaq'],
  ['Barka', [57.87, 23.67], 'rustaq'],
  ['Muscat', [58.55, 23.58], 'muscat'],
  ['Buraimi', [55.79, 24.25], 'buraimi'],
  ['Ibri', [56.52, 23.23], 'buraimi'],
  ['Nizwa', [57.53, 22.93], 'nizwa'],
  ['Sur', [59.5, 22.56], 'sharqiyah'],
  ['Ibra', [58.53, 22.69], 'sharqiyah'],
];

describe('Strait of Hormuz (community_strait_of_hormuz)', () => {
  const map = read('../../../database/maps/community_strait_of_hormuz.json') as MapJson;
  const subset = read('../../public/geo/strait_of_hormuz_admin1.json') as GeoJSON.FeatureCollection;
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

  it('draws every territory from its own admin-1 pieces, never the fallback outline', () => {
    const byCode = new Map(subset.features.map((f) => [f.properties!.iso_3166_2 as string, f.geometry as Geom]));
    for (const t of map.territories) {
      const expected = t.admin1.reduce((sum, code) => {
        const g = byCode.get(code);
        expect(g, `${t.territory_id}: ${code} missing from the subset`).toBeTruthy();
        return sum + turfArea(feature(g!));
      }, 0);
      const drawn = turfArea(feature(geoms.get(t.territory_id)!));
      expect(Math.abs(drawn - expected) / expected, t.territory_id).toBeLessThan(0.01);
    }
  });

  it('winds every exterior ring the way the globe fills it, or it draws as shards', () => {
    // d3-geo reads a counter-clockwise exterior as the polygon's complement
    // (globeTerritoryGeometry.regional.test.ts); a single-code territory reaches
    // the globe exactly as the subset stores it, with no union to rewind it.
    const ccw: string[] = [];
    for (const [id, g] of geoms) {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      polys.forEach((poly, i) => {
        if (signedLngLatRingArea(poly[0].slice(0, -1) as [number, number][]) <= 0) ccw.push(`${id}[${i}]`);
      });
    }
    expect(ccw).toEqual([]);
  });

  it('keeps a real outline as the fallback, should the admin-1 subset not load', () => {
    const full = read('../../../database/maps/community_strait_of_hormuz.json') as {
      territories: { territory_id: string; geo_polygon: [number, number][] }[];
    };
    for (const t of full.territories) {
      expect(t.geo_polygon.length, t.territory_id).toBeGreaterThanOrEqual(8);
      const g = geoms.get(t.territory_id)!;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      const largest = Math.max(...polys.map((poly) => turfArea({ type: 'Polygon', coordinates: poly })));
      const ring = [...t.geo_polygon, t.geo_polygon[0]];
      const outline = turfArea({ type: 'Polygon', coordinates: [ring] });
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
  });

  it('never draws two territories over each other', () => {
    const ids = [...geoms.keys()];
    const overlaps: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = geoms.get(ids[i])!;
        const b = geoms.get(ids[j])!;
        const inter = intersection(a.coordinates as never, b.coordinates as never) as unknown as GeoJSON.Position[][][];
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
    const seen = new Set<string>(['bushehr']);
    const queue = ['bushehr'];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    expect(seen.size).toBe(map.territories.length);
  });

  it('is offered in the lobby and the map hub in place of the grid-built map it replaces', () => {
    expect(CURATED_COMMUNITY_MAP_IDS).toContain('community_strait_of_hormuz');
    expect(CURATED_COMMUNITY_MAP_IDS).not.toContain('community_strait_hormuz');
    expect(REGIONAL_MAPS.map((m) => m.map_id)).toContain('community_strait_of_hormuz');
    expect(REGIONAL_MAPS.map((m) => m.map_id)).not.toContain('community_strait_hormuz');
    const hub = REGIONAL_MAPS.find((m) => m.map_id === 'community_strait_of_hormuz')!;
    expect(hub.territory_count).toBe(map.territories.length);
  });
});

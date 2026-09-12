import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTerritoryGlobeGeometries } from '../utils/globeTerritoryGeometry';
import {
  COUNTRY_HOMELANDS,
  TERRITORY_GEO_CONFIG,
  TERRITORY_ISO_MAP,
  type ClipBbox,
  type GeoConfigItem,
} from './territoryGeoMapping';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = path.resolve(__dirname, '../../../database/maps');

/**
 * Guards where the overseas possessions live.
 *
 * `COUNTRY_HOMELANDS` trims French Guiana, the Antilles, the Canaries,
 * Svalbard, Mayotte, Réunion, Tokelau, Christmas and the Cocos Islands off
 * their parent country so a bare `FR` stops painting Gaul across South
 * America, and re-registers each under its own ISO code. The era boards then
 * claim those codes from the territory that actually neighbours them.
 *
 * The trap this catches: a possession code is just two letters in a list, and
 * nothing about `['MA', 'DZ', 'TN', 'LY', 'IC']` tells a reader the Canaries
 * are anywhere near North Africa. Pasted onto the wrong line it would silently
 * paint an island on the far side of the planet in that territory's colour —
 * exactly the bug the homeland trim was written to remove, only harder to
 * spot. So the check is geometric, not a hardcoded expectation list: whatever
 * a board claims must lie within MAX_NEIGHBOUR_KM of the REST of that
 * territory, measured against the shipped Natural Earth polygons.
 *
 * Double-claims inside one era are covered next door in
 * territoryGeoMapping.test.ts; this file only asks "is it plausibly adjacent".
 */

/** Réunion sits ~1170 km east of Madagascar — the widest gap any board claims. */
const MAX_NEIGHBOUR_KM = 1300;

const countriesGeo = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../public/geo/ne_50m_admin_0_countries.json'),
    'utf-8',
  ),
) as GeoJSON.FeatureCollection;

type PolyGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type MapTerritory = {
  territory_id: string;
  name?: string;
  geo_config?: GeoConfigItem[];
  iso_codes?: string[];
  clip_bbox?: ClipBbox;
};

const ERA_MAP_IDS = fs
  .readdirSync(MAPS_DIR)
  .filter((n) => n.startsWith('era_') && n.endsWith('.json'))
  .map((n) => n.replace(/\.json$/, ''))
  .sort();

const POSSESSION_CODES = Object.values(COUNTRY_HOMELANDS).flatMap((d) =>
  Object.keys(d.possessions ?? {}),
);

function polygonsOf(geom: PolyGeom): GeoJSON.Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

function ringBbox(poly: GeoJSON.Position[][]): ClipBbox {
  const lngs = poly[0].map((c) => c[0]);
  const lats = poly[0].map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function touches(a: ClipBbox, b: ClipBbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/**
 * Split every country in the GeoJSON the way the globe builder does: homeland
 * rings under the country code, each trimmed ring under its possession code.
 */
const ringsByCode = new Map<string, GeoJSON.Position[][][]>();
for (const feature of countriesGeo.features) {
  const props = feature.properties ?? {};
  const geom = feature.geometry;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
  for (const raw of new Set([props['ISO_A2'], props['ISO_A2_EH']])) {
    const iso = typeof raw === 'string' && raw !== '-99' ? raw : null;
    if (!iso) continue;
    const def = COUNTRY_HOMELANDS[iso];
    for (const poly of polygonsOf(geom as PolyGeom)) {
      const bbox = ringBbox(poly);
      let code = iso;
      if (def && !def.homeland.some((box) => touches(box, bbox))) {
        const lng = (bbox[0] + bbox[2]) / 2;
        const lat = (bbox[1] + bbox[3]) / 2;
        const hit = Object.entries(def.possessions ?? {}).find(
          ([, b]) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3],
        );
        if (!hit) continue; // dropped with no code of its own (Azores, Galápagos…)
        code = hit[0];
      }
      const list = ringsByCode.get(code) ?? [];
      list.push(poly);
      ringsByCode.set(code, list);
    }
  }
}

function verticesOf(code: string, clip?: ClipBbox): GeoJSON.Position[] {
  const out: GeoJSON.Position[] = [];
  for (const poly of ringsByCode.get(code) ?? []) {
    for (const c of poly[0]) {
      if (clip && !(c[0] >= clip[0] && c[0] <= clip[2] && c[1] >= clip[1] && c[1] <= clip[3])) {
        continue;
      }
      out.push(c);
    }
  }
  return out;
}

/** Great-circle distance in km. */
function distanceKm(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lat2] = [toRad(a[1]), toRad(b[1])];
  const dLat = lat2 - lat1;
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sampled minimum distance — dense enough for a 1300 km threshold. */
function minDistanceKm(a: GeoJSON.Position[], b: GeoJSON.Position[]): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 5) {
      const d = distanceKm(a[i], b[j]);
      if (d < best) best = d;
    }
  }
  return best;
}

function loadMap(mapId: string): { territories: MapTerritory[] } {
  return JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${mapId}.json`), 'utf-8'));
}

/** The codes a territory claims, in the builder's resolution order. */
function claimsOf(t: MapTerritory): { code: string; clip?: ClipBbox }[] {
  const inlineConfig = t.geo_config;
  if (inlineConfig?.length) return inlineConfig.map((i) => ({ code: i.iso, clip: i.clip_bbox }));
  if (t.iso_codes?.length) return t.iso_codes.map((c) => ({ code: c, clip: t.clip_bbox }));
  const preset = TERRITORY_GEO_CONFIG[t.territory_id];
  if (preset?.length) return preset.map((i) => ({ code: i.iso, clip: i.clip_bbox }));
  const isoPreset = TERRITORY_ISO_MAP[t.territory_id];
  if (isoPreset?.length) return isoPreset.map((c) => ({ code: c, clip: t.clip_bbox }));
  return [];
}

describe('overseas possessions are claimed by a neighbouring territory', () => {
  it('every possession code resolves to real polygons in the shipped GeoJSON', () => {
    expect(POSSESSION_CODES.length).toBeGreaterThan(0);
    for (const code of POSSESSION_CODES) {
      expect(ringsByCode.get(code)?.length ?? 0, `${code} has no polygons`).toBeGreaterThan(0);
    }
  });

  for (const mapId of ERA_MAP_IDS) {
    it(`${mapId}: each claimed possession sits beside the rest of its territory`, () => {
      const territories = loadMap(mapId).territories;
      let checked = 0;
      for (const t of territories) {
        const claims = claimsOf(t);
        const possessions = claims.filter((c) => POSSESSION_CODES.includes(c.code));
        if (possessions.length === 0) continue;
        const neighbourVertices = claims
          .filter((c) => !POSSESSION_CODES.includes(c.code))
          .flatMap((c) => verticesOf(c.code, c.clip));
        // A territory made only of possessions has nothing to be adjacent to.
        expect(
          neighbourVertices.length,
          `${t.territory_id} claims only possessions`,
        ).toBeGreaterThan(0);
        for (const { code } of possessions) {
          const km = minDistanceKm(verticesOf(code), neighbourVertices);
          expect(
            Math.round(km),
            `${mapId}: ${t.territory_id} (${t.name}) claims ${code} ${Math.round(km)} km away`,
          ).toBeLessThanOrEqual(MAX_NEIGHBOUR_KM);
          checked += 1;
        }
      }
      // Every world board should place at least a few of them; a map that
      // silently stopped resolving its presets would otherwise pass by default.
      if (!['era_acw', 'era_risorgimento', 'era_galaxy'].includes(mapId)) {
        expect(checked, `${mapId} claims no possessions at all`).toBeGreaterThan(0);
      }
    });
  }

  it(
    'the builder actually emits the island for the territory that claims it',
    () => {
      // Adjacency above is a data check; this one proves the geometry arrives.
      // Each entry: era map, territory, possession, and a box its polygon must
      // fall in. Grouped so each map is built once — the clipping pass is slow.
      const cases: [string, string, string, ClipBbox][] = [
        ['era_modern', 'scandinavia_mod', 'SJ', [10, 70, 36, 81]],
        ['era_modern', 'australia_mod', 'TK', [-173, -10, -170, -8]],
        ['era_modern', 'east_africa_mod', 'RE', [55, -22, 56, -20]],
        ['era_modern', 'colombia_mod', 'GF', [-55, 1, -51, 7]],
        ['era_medieval', 'madagascar', 'YT', [44, -14, 46, -12]],
        ['era_ww2', 'morocco_ww2', 'IC', [-19, 27, -13, 30]],
        ['era_coldwar', 'indonesia_cw', 'CX', [105, -11, 106, -10]],
        ['era_space_age', 'la_caribbean', 'MQ', [-62, 14, -60, 15]],
      ];
      const built = new Map<string, Map<string, PolyGeom>>();
      for (const mapId of new Set(cases.map((c) => c[0]))) {
        const geometries = buildTerritoryGlobeGeometries(
          { ...(loadMap(mapId) as any), map_id: mapId },
          {
            countriesGeo,
            statesGeo: null,
            risorgimentoGeo: null,
            admin50Geo: null,
            straitHormuzGeo: null,
            australiaGeo: null,
            britainGeo: null,
            hornAfricaGeo: null,
            mexicoGeo: null,
            regionalAdmin1Geo: null,
          },
        );
        built.set(
          mapId,
          new Map(geometries.map((g) => [g.territory_id, g.geometry as PolyGeom])),
        );
      }
      for (const [mapId, territoryId, code, box] of cases) {
        const geometry = built.get(mapId)?.get(territoryId);
        expect(geometry, `${mapId}/${territoryId} produced no geometry`).toBeDefined();
        const hit = polygonsOf(geometry!).some((poly) => {
          const b = ringBbox(poly);
          const lng = (b[0] + b[2]) / 2;
          const lat = (b[1] + b[3]) / 2;
          return lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
        });
        expect(hit, `${mapId}/${territoryId} is missing its ${code} polygon`).toBe(true);
      }
    },
    60_000,
  );

  it('the Ancient board still leaves the far-flung islands unclaimed', () => {
    // southern_africa is shared with the Medieval board, where Madagascar (70 km
    // from Mayotte) is the better owner, so Mayotte stays grey here rather than
    // double-claiming there. Réunion and Tokelau have no tile within 1000 km.
    const claimed = new Set(
      loadMap('era_ancient').territories.flatMap((t) => claimsOf(t).map((c) => c.code)),
    );
    for (const code of ['YT', 'RE', 'TK']) expect(claimed.has(code), code).toBe(false);
    for (const code of ['GF', 'GP', 'MQ', 'BQ', 'IC', 'SJ', 'CX', 'CC']) {
      expect(claimed.has(code), code).toBe(true);
    }
  });
});

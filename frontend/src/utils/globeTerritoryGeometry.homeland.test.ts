import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';
import { homelandGeometry, registerPossessionFeatures } from './countryHomeland';
import { COUNTRY_HOMELANDS, TERRITORY_ISO_MAP } from '../data/territoryGeoMapping';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Regression guard for the overseas-territory bleed on the globe.
 *
 * Natural Earth folds integral overseas territory into the parent country's
 * feature: France carries French Guiana, Guadeloupe, Martinique, Mayotte and
 * Réunion. Every era whose France/Gaul/Iberia is a bare country reference drew
 * those pieces in the owner's colour — a French blob on the coast of Brazil and
 * Spanish specks off Morocco. A bare reference now means the homeland only;
 * the trimmed pieces are re-registered under their own ISO codes so a map can
 * still claim them by name, and an authored clip_bbox is never trimmed because
 * the box already says which part of the country is meant.
 *
 * Runs against the shipped ne_50m file so a data refresh can't silently
 * re-introduce a possession the boxes don't know about.
 */
const countriesGeo = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/geo/ne_50m_admin_0_countries.json'), 'utf-8'),
) as GeoJSON.FeatureCollection;

const INPUTS = {
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
};

type PolyGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function polygonsOf(geom: PolyGeom): GeoJSON.Position[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

/** Bounding boxes of every polygon in a geometry, rounded for readable failures. */
function polygonBboxes(geom: PolyGeom): [number, number, number, number][] {
  return polygonsOf(geom).map((poly) => {
    const lngs = poly[0].map((c) => c[0]);
    const lats = poly[0].map((c) => c[1]);
    return [
      Math.round(Math.min(...lngs)),
      Math.round(Math.min(...lats)),
      Math.round(Math.max(...lngs)),
      Math.round(Math.max(...lats)),
    ];
  });
}

function withinLng(geom: PolyGeom, minLng: number, maxLng: number): boolean {
  return polygonBboxes(geom).every((b) => b[0] >= minLng && b[2] <= maxLng);
}

function featureFor(iso: string): GeoJSON.Feature {
  const f = countriesGeo.features.find((c) => c.properties?.['ISO_A2_EH'] === iso);
  if (!f) throw new Error(`no ${iso} feature in ne_50m`);
  return f;
}

function buildOne(territory: Record<string, unknown>) {
  const map = {
    map_id: 'era_ancient',
    canvas_width: 1200,
    canvas_height: 700,
    territories: [
      {
        name: String(territory.territory_id),
        region_id: 'r',
        polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
        center_point: [5, 5] as [number, number],
        ...territory,
      },
    ],
  };
  const out = buildTerritoryGlobeGeometries(map as any, INPUTS);
  expect(out).toHaveLength(1);
  return out[0].geometry as PolyGeom;
}

describe('bare country references draw the homeland only', () => {
  it('the shipped France feature really does carry the overseas pieces (test precondition)', () => {
    const fr = featureFor('FR').geometry as PolyGeom;
    const boxes = polygonBboxes(fr);
    expect(boxes.some((b) => b[0] <= -51 && b[2] >= -55)).toBe(true); // French Guiana
    expect(boxes.some((b) => b[0] >= 55)).toBe(true); // Réunion
  });

  it('Ancient gaul is a bare ISO preset and stays inside Europe', () => {
    expect(TERRITORY_ISO_MAP.gaul).toEqual(['FR', 'BE', 'NL', 'LU', 'CH']);
    const gaul = buildOne({ territory_id: 'gaul' });
    expect(withinLng(gaul, -6, 10)).toBe(true);
    // Corsica survives the trim (it is in the homeland box, not a possession).
    expect(polygonBboxes(gaul).some((b) => b[0] >= 8 && b[1] >= 41 && b[3] <= 43)).toBe(true);
  });

  it('Ancient hispania keeps the Balearics and loses the Canaries, Azores and Madeira', () => {
    const hispania = buildOne({ territory_id: 'hispania' });
    expect(withinLng(hispania, -10, 5)).toBe(true);
    expect(polygonBboxes(hispania).some((b) => b[0] >= 1 && b[1] >= 39)).toBe(true); // Balearics
  });

  it('every configured homeland keeps at least the mainland polygon', () => {
    for (const iso of Object.keys(COUNTRY_HOMELANDS)) {
      const feats = countriesGeo.features.filter((c) => c.properties?.['ISO_A2_EH'] === iso);
      expect(feats.length, iso).toBeGreaterThan(0);
      const kept = feats
        .map((f) => homelandGeometry(iso, f.geometry as PolyGeom))
        .filter((g): g is PolyGeom => g !== null);
      expect(kept.length, iso).toBeGreaterThan(0);
      const largestRing = Math.max(...kept.flatMap((g) => polygonsOf(g).map((p) => p[0].length)));
      expect(largestRing, `${iso} mainland should be a long ring`).toBeGreaterThan(100);
    }
  });

  it('a bare geo_config item is trimmed like an ISO preset', () => {
    const euro = buildOne({ territory_id: 'euro_spaceport' }); // TERRITORY_GEO_CONFIG: bare FR/BE/NL/LU/CH
    expect(withinLng(euro, -6, 16)).toBe(true);
  });

  it('an authored clip_bbox is never trimmed: FR with a Caribbean box still reaches the Antilles', () => {
    const antilles = buildOne({
      territory_id: 'custom_antilles',
      geo_config: [{ iso: 'FR', clip_bbox: [-85, 14, -54, 31] }],
    });
    const boxes = polygonBboxes(antilles);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b[0] >= -63 && b[2] <= -60)).toBe(true);
  });

  it('legacy iso_codes + clip_bbox keeps the whole country for the box to cut', () => {
    const guiana = buildOne({
      territory_id: 'custom_guiana',
      iso_codes: ['FR'],
      clip_bbox: [-56, 1, -50, 7],
    });
    expect(polygonBboxes(guiana).every((b) => b[0] >= -56 && b[2] <= -50)).toBe(true);
  });

  it('a territory-level clip_polygon also keeps the whole country for the polygon to cut', () => {
    const guiana = buildOne({
      territory_id: 'custom_guiana_poly',
      geo_config: [{ iso: 'FR' }],
      clip_polygon: [[[-56, 1], [-50, 1], [-50, 7], [-56, 7], [-56, 1]]],
    });
    const boxes = polygonBboxes(guiana);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b[0] >= -56 && b[2] <= -50)).toBe(true);
  });

  it('trimmed pieces resolve under their own ISO codes (GF, RE, IC, SJ)', () => {
    for (const [code, [minLng, maxLng]] of Object.entries({
      GF: [-56, -51],
      RE: [55, 56],
      IC: [-19, -13],
      SJ: [-10, 34],
    })) {
      const geom = buildOne({ territory_id: `custom_${code}`, geo_config: [{ iso: code }] });
      expect(withinLng(geom, minLng, maxLng), code).toBe(true);
      expect(polygonBboxes(geom).length, code).toBeGreaterThan(0);
    }
  });

  it('possession registration never shadows a code the GeoJSON already has', () => {
    const index = new Map<string, GeoJSON.Feature[]>();
    const sentinel: GeoJSON.Feature = {
      type: 'Feature',
      properties: { ISO_A2: 'GF' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    index.set('GF', [sentinel]);
    index.set('FR', [featureFor('FR')]);
    registerPossessionFeatures(index);
    expect(index.get('GF')).toEqual([sentinel]);
    expect(index.has('RE')).toBe(true);
  });

  it('countries without a homeland entry pass through untouched', () => {
    const de = featureFor('DE').geometry as PolyGeom;
    expect(homelandGeometry('DE', de)).toBe(de);
  });
});

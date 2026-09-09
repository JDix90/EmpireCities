import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACW_TERRITORY_STATES } from '../data/acwStateMap';
import { TERRITORY_GEO_CONFIG } from '../data/territoryGeoMapping';
import { buildTerritoryGlobeGeometries } from './globeTerritoryGeometry';

/**
 * American Civil War territories draw from real Natural Earth admin-1 state
 * polygons. The `US` clip boxes in TERRITORY_GEO_CONFIG are what they fall back
 * to when that fails, and era_acw.json has no `projection_bounds` — so without
 * those boxes the map would world-project an abstract board layout and scatter
 * the territories across the globe. They have to be right, not just present.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadJson = (p: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf-8'));

const statesGeo = loadJson('../../public/geo/ne_110m_admin_1_states_provinces.json');
const acwMap = loadJson('../../../database/maps/era_acw.json');
const countriesGeo = loadJson('../../public/geo/ne_50m_admin_0_countries.json');

type Ring = number[][];
function stateRings(): Map<string, Ring[]> {
  const out = new Map<string, Ring[]>();
  for (const f of statesGeo.features) {
    const props = f.properties ?? {};
    if (props['adm0_a3'] !== 'USA') continue;
    const postal = props['postal'];
    if (typeof postal !== 'string' || postal === 'AK' || postal === 'HI') continue;
    const g = f.geometry;
    if (!g) continue;
    out.set(postal, g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
  }
  return out;
}

function pointInRing(pt: number[], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

describe('ACW admin-1 rendering', () => {
  it('resolves every territory from the shipped states file', () => {
    // The fallback below exists for when this stops being true; if it ever
    // does, this is where it shows up rather than as a quietly wrong map.
    const rings = stateRings();
    for (const [tid, states] of Object.entries(ACW_TERRITORY_STATES)) {
      const missing = states.filter((s) => !rings.has(s));
      expect(missing, `${tid} cannot resolve ${missing.join(',')}`).toEqual([]);
    }
  });

  it('draws the states it has when one of them goes missing', () => {
    // Regression: the union used to require ALL of a territory's states, so a
    // single renamed postal code dropped the whole territory to a US-wide clip
    // box — a far bigger error than the one missing state.
    const dropped = 'PA'; // acw_mid_atlantic: NY NJ PA DE MD DC
    const thinned = {
      ...statesGeo,
      features: statesGeo.features.filter(
        (f: { properties?: Record<string, unknown> }) =>
          !(f.properties?.['adm0_a3'] === 'USA' && f.properties?.['postal'] === dropped),
      ),
    };
    const polys = buildTerritoryGlobeGeometries(
      acwMap as Parameters<typeof buildTerritoryGlobeGeometries>[0],
      { countriesGeo, statesGeo: thinned, risorgimentoGeo: null },
    );
    const midAtlantic = polys.find((p) => p.territory_id === 'acw_mid_atlantic')!;

    const contains = (lng: number, lat: number) => {
      const g = midAtlantic.geometry;
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      return polygons.some(
        (poly) =>
          pointInRing([lng, lat], poly[0] as Ring) &&
          !poly.slice(1).some((hole) => pointInRing([lng, lat], hole as Ring)),
      );
    };

    // Both of these separate the two behaviours; points that merely sit inside
    // both the real states and the fallback box would pass either way.
    //
    // Eastern Long Island is real New York the box cannot reach: the box stops
    // at lng -73.4 and the island runs past -72.5.
    expect(contains(-72.5, 40.9), 'eastern Long Island').toBe(true);
    // Harrisburg and Pittsburgh are inside the box but inside the state that
    // was dropped, so they prove this is a partial union of what resolved and
    // not the fallback quietly filling the gap.
    expect(contains(-76.88, 40.27), 'Harrisburg, Pennsylvania').toBe(false);
    expect(contains(-80.0, 40.44), 'Pittsburgh, Pennsylvania').toBe(false);
  });
});

describe('ACW fallback boxes', () => {
  const boxes = Object.fromEntries(
    Object.keys(ACW_TERRITORY_STATES).map((tid) => [
      tid,
      (TERRITORY_GEO_CONFIG[tid] ?? []).map((c) => c.clip_bbox!),
    ]),
  );

  it('gives every territory at least one box', () => {
    // era_acw.json carries no projection_bounds, so a territory with no entry
    // here loses hasGeoMapping and lands somewhere random on the world map.
    for (const [tid, list] of Object.entries(boxes)) {
      expect(list.length, `${tid} has no fallback box`).toBeGreaterThan(0);
      for (const b of list) expect(b, tid).toHaveLength(4);
    }
  });

  it('covers the states it claims, and puts them in the right territory', () => {
    // Rectangles cannot follow interlocking state borders (the Ohio River, the
    // Georgia/Carolina diagonal), so this is a floor on a crude fallback, not a
    // demand for exactness. Before the boxes were re-tiled it scored 79.5% with
    // 512 unclaimed sample points; the tiling holds it above 90% with almost
    // none unclaimed.
    const rings = stateRings();
    const want = new Map<string, string>();
    for (const [tid, states] of Object.entries(ACW_TERRITORY_STATES)) {
      for (const s of states) want.set(s, tid);
    }

    let correct = 0;
    let total = 0;
    let unclaimed = 0;
    for (const [postal, polys] of rings) {
      const owner = want.get(postal);
      if (!owner) continue;
      const pts = polys.flat();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      for (let gx = 0; gx <= 12; gx++) {
        for (let gy = 0; gy <= 12; gy++) {
          const pt = [
            Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * gx) / 12,
            Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * gy) / 12,
          ];
          if (!polys.some((r) => pointInRing(pt, r))) continue;
          total++;
          const claimers = Object.entries(boxes).filter(([, list]) =>
            list.some((b) => pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3]),
          );
          if (claimers.length === 0) unclaimed++;
          else if (claimers.some(([t]) => t === owner)) correct++;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(correct / total).toBeGreaterThan(0.9);
    expect(unclaimed / total).toBeLessThan(0.02);
  });
});

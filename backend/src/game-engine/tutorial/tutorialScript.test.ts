/**
 * The tutorial board must be real geography, and the board must agree with it.
 *
 * It used to be "Tutorial Island": six rectangles on a 20x20 canvas, floated on
 * empty mid-Atlantic ocean precisely so that no real coastline could contradict
 * them. That is most players' first look at Borderfall, and a board of coloured
 * boxes says the whole game is boxes.
 *
 * It is now mainland Italy, built from Natural Earth provinces. Real geometry
 * brings a failure mode the invented island did not have — the board can
 * silently disagree with the world it claims to be — so the checks here are
 * about that agreement:
 *
 *  - every `admin1` code resolves in the committed source, or the territory
 *    quietly falls back to its outline polygon and the board is blocky again
 *    with nothing failing;
 *  - every declared `connection` is a border the two territories really share,
 *    and every border they really share is declared. Natural Earth provinces
 *    from one file share exact vertices along a common boundary, so this is
 *    decidable from the data: adjacent territory pairs share hundreds of
 *    vertices here and non-adjacent pairs share none.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getTutorialMap } from './tutorialScript';
import { validateMapGeometry } from '../validation/mapGeometry';
import { validateMapConnections } from '../validation/mapConnections';

/**
 * The coaching cards live in the frontend workspace and name these territories
 * by their display name, so a rename here silently makes the tutorial point at
 * something that is not on the board. Read as text (the two workspaces cannot
 * import each other) purely to pin that the names still agree.
 */
const CORE_STEPS = join(
  __dirname, '..', '..', '..', '..',
  'frontend', 'src', 'tutorial', 'modules', 'combinedCoreSteps.ts',
);

/** The same file `useTerritoryGeoSources` serves this map id at runtime. */
const GEO_SOURCE = join(
  __dirname, '..', '..', '..', '..',
  'frontend', 'public', 'geo', 'risorgimento_admin1.json',
);

interface GeoFeature {
  properties: { iso_3166_2?: string };
  geometry: { coordinates: unknown };
}

const source = JSON.parse(readFileSync(GEO_SOURCE, 'utf8')) as { features: GeoFeature[] };
const geomByCode = new Map<string, unknown>();
for (const f of source.features) {
  const code = f.properties?.iso_3166_2;
  if (code) geomByCode.set(code, f.geometry.coordinates);
}

/** Every vertex in a GeoJSON coordinate tree, rounded to the source's precision. */
function vertices(coords: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.add(`${(node[0] as number).toFixed(6)},${(node[1] as number).toFixed(6)}`);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coords);
  return out;
}

const map = getTutorialMap();
const territories = map.territories;
const ids = territories.map((t) => t.territory_id);

/** Real-world vertex set per territory: the union of its provinces'. */
const vertsByTerritory = new Map<string, Set<string>>(
  territories.map((t) => {
    const all = new Set<string>();
    for (const code of t.admin1 ?? []) {
      const coords = geomByCode.get(code);
      if (coords) for (const v of vertices(coords)) all.add(v);
    }
    return [t.territory_id, all];
  }),
);

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

describe('the tutorial board is real geography', () => {
  it('draws every territory from Natural Earth provinces, not an invented shape', () => {
    expect(territories).toHaveLength(6);
    for (const t of territories) {
      expect(t.admin1?.length, `${t.territory_id} has no admin-1 codes`).toBeGreaterThan(0);
    }
  });

  it('every admin-1 code resolves in the committed source', () => {
    // A code that does not resolve is silent: the territory falls back to its
    // outline polygon and the board goes back to looking authored.
    const unresolved: string[] = [];
    for (const t of territories) {
      for (const code of t.admin1 ?? []) {
        if (!geomByCode.has(code)) unresolved.push(`${t.territory_id}:${code}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('claims each province exactly once, so no two territories double-draw', () => {
    const seen = new Map<string, string>();
    const duplicated: string[] = [];
    for (const t of territories) {
      for (const code of t.admin1 ?? []) {
        const prev = seen.get(code);
        if (prev) duplicated.push(`${code}: ${prev} and ${t.territory_id}`);
        else seen.set(code, t.territory_id);
      }
    }
    expect(duplicated).toEqual([]);
    // The repo's own offline validator agrees — an unclipped shared code is the
    // double-draw class it exists to catch.
    expect(validateMapGeometry(map as never)).toEqual([]);
  });

  it('declares every border these territories really share, and no border they do not', () => {
    const declared = new Set(map.connections.map((c) => pairKey(c.from, c.to)));

    const real = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = vertsByTerritory.get(ids[i])!;
        const b = vertsByTerritory.get(ids[j])!;
        let shared = 0;
        for (const v of a) if (b.has(v)) shared++;
        // Provinces in one Natural Earth file share exact vertices along a
        // common boundary. The gap is not marginal: real neighbours here share
        // 38–645 vertices and non-neighbours share 0, so any threshold in
        // between decides it. Two is "they touch along a segment", not a point.
        if (shared >= 2) real.add(pairKey(ids[i], ids[j]));
      }
    }

    const invented = [...declared].filter((p) => !real.has(p));
    const missing = [...real].filter((p) => !declared.has(p));
    expect({ invented, missing }).toEqual({ invented: [], missing: [] });
  });

  it('keeps the board fully connected', () => {
    expect(validateMapConnections(map as never)).toEqual([]);
  });

  it('keeps the teaching shape the authored opening is written against', () => {
    const neighbours = (id: string) => new Set(
      map.connections
        .filter((c) => c.from === id || c.to === id)
        .map((c) => (c.from === id ? c.to : c.from)),
    );
    // The player's realm must be internally connected, or fortify has nothing
    // to teach.
    const west = territories.filter((t) => t.region_id === 'tut_west').map((t) => t.territory_id);
    expect(west).toHaveLength(3);
    for (const id of west) {
      const reach = neighbours(id);
      expect(west.some((other) => other !== id && reach.has(other)), `${id} is cut off`).toBe(true);
    }
    // `tut_b1` is the eastern hub the opening card points at: it alone touches
    // both other Adriatic lands, which is why taking it is the cheap opening.
    const b1 = neighbours('tut_b1');
    expect(b1.has('tut_b2')).toBe(true);
    expect(b1.has('tut_b3')).toBe(true);
    expect(b1.has('tut_a1')).toBe(true);
    // Every human territory has a front, so no seat is a spectator.
    for (const id of west) {
      const east = [...neighbours(id)].filter((n) => n.startsWith('tut_b'));
      expect(east.length, `${id} has no front`).toBeGreaterThan(0);
    }
  });
});

describe('the coaching cards name this board', () => {
  const steps = readFileSync(CORE_STEPS, 'utf8');
  const names = new Set(territories.map((t) => t.name));
  const realms = new Set(map.regions.map((r) => r.name));

  it('names only fronts that exist, in a direction the board allows', () => {
    // The cards write a front as `**Source → Target**`.
    const fronts = [...steps.matchAll(/\*\*([^*]+?) → ([^*]+?)\*\*/g)]
      .map((m) => [m[1].trim(), m[2].trim()] as const)
      // The phase buttons are bolded arrows too (`Draft → Attack → Fortify`);
      // a front is a pair of territory names, so anything else is not one.
      .filter(([a, b]) => names.has(a) || names.has(b));
    expect(fronts.length, 'the attack card names no front at all').toBeGreaterThan(0);

    const declared = new Set(map.connections.map((c) => [c.from, c.to].sort().join('|')));
    const idOf = new Map(territories.map((t) => [t.name, t.territory_id]));
    for (const [from, to] of fronts) {
      expect(names.has(from), `card names "${from}", which is not on the board`).toBe(true);
      expect(names.has(to), `card names "${to}", which is not on the board`).toBe(true);
      const key = [idOf.get(from)!, idOf.get(to)!].sort().join('|');
      expect(declared.has(key), `card names ${from} → ${to}, which do not border`).toBe(true);
    }
  });

  it('names the realms as the board labels them', () => {
    for (const realm of realms) {
      expect(steps.includes(realm), `no card mentions the realm "${realm}"`).toBe(true);
    }
  });
});

describe('the tutorial board is framed to be looked at', () => {
  it('frames the whole theatre inside projection_bounds', () => {
    const b = map.projection_bounds!;
    for (const t of territories) {
      for (const [lng, lat] of t.geo_polygon ?? []) {
        expect(lng, `${t.territory_id} lng`).toBeGreaterThanOrEqual(b.minLng);
        expect(lng, `${t.territory_id} lng`).toBeLessThanOrEqual(b.maxLng);
        expect(lat, `${t.territory_id} lat`).toBeGreaterThanOrEqual(b.minLat);
        expect(lat, `${t.territory_id} lat`).toBeLessThanOrEqual(b.maxLat);
      }
    }
  });

  it('matches the canvas aspect to the physical one, so 2D and globe agree', () => {
    const b = map.projection_bounds!;
    const midLat = (b.minLat + b.maxLat) / 2;
    // A degree of longitude covers cos(lat) of a degree of latitude, and the 2D
    // map reads canvas coordinates as square pixels. If these disagree, one
    // view draws the peninsula a different shape from the other.
    const physical = ((b.maxLng - b.minLng) * Math.cos((midLat * Math.PI) / 180)) / (b.maxLat - b.minLat);
    const canvas = map.canvas_width! / map.canvas_height!;
    expect(Math.abs(canvas - physical)).toBeLessThan(0.01);
  });

  it('centres the locked globe view on the theatre', () => {
    const b = map.projection_bounds!;
    const view = map.globe_view!;
    expect(view.lock_rotation).toBe(true);
    expect(view.center_lng).toBeCloseTo((b.minLng + b.maxLng) / 2, 1);
    expect(view.center_lat).toBeCloseTo((b.minLat + b.maxLat) / 2, 1);
    // Above the altitude at which react-globe.gl stops drawing polygon caps and
    // leaves only their side walls.
    expect(view.altitude!).toBeGreaterThan(0.15);
    // …and close enough that the theatre is not a thumbnail: the visible window
    // is roughly altitude x 54 degrees.
    expect(view.altitude! * 54).toBeLessThan(3 * (b.maxLat - b.minLat));
  });
});

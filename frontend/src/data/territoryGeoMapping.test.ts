import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TERRITORY_GEO_CONFIG,
  TERRITORY_ISO_MAP,
  type ClipBbox,
  type GeoConfigItem,
} from './territoryGeoMapping';
import { GALAXY_SOL_TERRITORY_GEO } from './galaxySolGlobeGeo';

/**
 * Guards the invariant stated at the top of territoryGeoMapping.ts: within one
 * map, every ISO country code belongs to at most one territory. Two territories
 * claiming the same country draw the same land twice, and the tile takes
 * whichever owner's colour was painted last — on the Space Age board Yemen
 * visibly flickered between the Arabian Photovoltaic's owner and the Horn of
 * Africa's, and Guangzhou and Nanning were drawn by both Mandarin Heartland and
 * Coastal Megacities.
 *
 * A shared country is legal as long as the claims are clipped to disjoint
 * rectangles (Sudan is split between mena_nile and africa_sahel this way), so
 * the check is on the clip boxes, not on the ISO code alone.
 *
 * Scoped to the era maps: those are what resolve through these preset tables.
 * Community maps carry their own admin-1 tables and Voronoi clip polygons,
 * where bboxes deliberately overlap before a later clip trims them.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = path.resolve(__dirname, '../../../database/maps');

type MapTerritory = {
  territory_id: string;
  geo_config?: GeoConfigItem[];
  iso_codes?: string[];
  clip_bbox?: ClipBbox;
};

const ERA_MAP_IDS = fs
  .readdirSync(MAPS_DIR)
  .filter((n) => n.startsWith('era_') && n.endsWith('.json'))
  .map((n) => n.replace(/\.json$/, ''))
  .sort();

function loadMap(mapId: string): { territories: MapTerritory[] } {
  return JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${mapId}.json`), 'utf-8'));
}

/**
 * Mirrors the resolution order in buildTerritoryGlobeGeometries: an inline
 * `geo_config`, then the Sol III merge table, then the preset config, then the
 * plain ISO list (which the territory's own `clip_bbox` narrows).
 *
 * American Civil War territories used to be skipped here. They normally render
 * from real admin-1 state polygons, so their `US` boxes are only a fallback —
 * but a fallback that overlapped was still a tile that could draw over its
 * neighbour, and the exemption meant nothing caught it. The boxes tile now, so
 * the sweep covers them like everything else.
 */
function claimsFor(t: MapTerritory): GeoConfigItem[] | undefined {
  if (t.geo_config?.length) return t.geo_config;
  const sol = GALAXY_SOL_TERRITORY_GEO[t.territory_id];
  if (sol?.length) return sol;
  const preset = TERRITORY_GEO_CONFIG[t.territory_id];
  if (preset?.length) return preset;
  const isoCodes = t.iso_codes ?? TERRITORY_ISO_MAP[t.territory_id];
  if (isoCodes?.length) return isoCodes.map((iso) => ({ iso, clip_bbox: t.clip_bbox }));
  return undefined;
}

/** Half-open, so boxes that share an edge (the usual seam) do not count. */
function boxesIntersect(a: ClipBbox, b: ClipBbox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function findDoubleClaims(map: { territories: MapTerritory[] }): string[] {
  const byIso = new Map<string, { id: string; bbox?: ClipBbox }[]>();
  for (const t of map.territories) {
    for (const claim of claimsFor(t) ?? []) {
      const list = byIso.get(claim.iso) ?? [];
      list.push({ id: t.territory_id, bbox: claim.clip_bbox });
      byIso.set(claim.iso, list);
    }
  }

  const conflicts = new Set<string>();
  for (const [iso, claims] of byIso) {
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i];
        const b = claims[j];
        // A territory may claim one country as several rectangles to build an
        // L-shape (asia_heartland wraps around asia_coastal); only cross-
        // territory pairs collide.
        if (a.id === b.id) continue;
        if (!a.bbox || !b.bbox) {
          conflicts.add(
            `${iso}: ${a.id}${a.bbox ? JSON.stringify(a.bbox) : ' (whole country)'} ` +
              `vs ${b.id}${b.bbox ? JSON.stringify(b.bbox) : ' (whole country)'}`,
          );
        } else if (boxesIntersect(a.bbox, b.bbox)) {
          conflicts.add(
            `${iso}: ${a.id}${JSON.stringify(a.bbox)} vs ${b.id}${JSON.stringify(b.bbox)}`,
          );
        }
      }
    }
  }
  return [...conflicts].sort();
}

describe('era map geo claims', () => {
  it.each(ERA_MAP_IDS)('%s gives every country a single owner', (mapId) => {
    expect(findDoubleClaims(loadMap(mapId))).toEqual([]);
  });

  it('covers every era map on disk', () => {
    // Guards against the sweep above quietly narrowing to nothing.
    expect(ERA_MAP_IDS).toContain('era_space_age');
    expect(ERA_MAP_IDS).toContain('era_galaxy');
    expect(ERA_MAP_IDS.length).toBeGreaterThanOrEqual(8);
  });

  it('still allows a shared country split into disjoint slices', () => {
    // Sudan, the pattern the four Space Age fixes follow.
    const nile = TERRITORY_GEO_CONFIG.mena_nile.find((c) => c.iso === 'SD');
    const sahel = TERRITORY_GEO_CONFIG.africa_sahel.find((c) => c.iso === 'SD');
    expect(nile?.clip_bbox).toBeDefined();
    expect(sahel?.clip_bbox).toBeDefined();
    expect(boxesIntersect(nile!.clip_bbox!, sahel!.clip_bbox!)).toBe(false);
  });
});

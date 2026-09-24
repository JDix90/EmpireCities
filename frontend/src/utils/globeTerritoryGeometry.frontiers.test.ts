import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasGeoMapping } from '../data/territoryGeoMapping';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Coverage guard for era **growth-frontier** geometry (the sibling of the
 * double-draw guard in backend/src/game-engine/validation/mapGeometry.ts).
 *
 * Growth-model games stay on their starting era map and unlock frontier
 * territories — those with `unlock_era_index > 0` — as the era floor rises.
 * Each frontier resolves geometry in globeTerritoryGeometry.ts via, in order:
 *   1. inline `geo_config` / `iso_codes` on the territory, else
 *   2. a `TERRITORY_GEO_CONFIG` / `TERRITORY_ISO_MAP` preset (hasGeoMapping), else
 *   3. the crude synthetic `geo_polygon` rectangle — the flat gray BLOCK.
 *
 * Land frontiers repeatedly shipped with only a placeholder `geo_polygon` and
 * rendered as gray blocks while every base territory drew real coastline (the
 * Ancient board's Discovery wave, then medieval kamchatka). This test runs the
 * check across EVERY growth map in ERA_GROWTH_MAP_IDS so a frontier can't
 * silently regress to a block on any of them. Genuine open-ocean / orbital /
 * platform tiles with no real coastline to trace are exempted per map via
 * ALLOWED_SYNTHETIC — that list is the deliberate, audited set of non-land
 * frontiers; additions to it should be intentional design, not convenience.
 */

// Must mirror ERA_GROWTH_MAP_IDS (backend/src/game-engine/eraAdvancement/territoryUnlock.ts).
const ALLOWED_SYNTHETIC: Record<string, ReadonlySet<string>> = {
  // All Ancient frontiers are land/islands with real geometry.
  era_ancient: new Set(),
  era_discovery: new Set(['southern_ocean']),
  era_ww2: new Set(['mid_pacific', 'south_atlantic_ww2', 'weddell_sea', 'southern_ocean']),
  era_coldwar: new Set([
    'polar_arctic', 'indian_ocean', 'bering_strait', 'nonaligned_oceania', 'deep_pacific',
  ]),
  era_modern: new Set([
    'arctic_circle_mod', 'orbital_station_mod', 'bering_frontier_mod',
    'north_pacific_deep_mod', 'southern_ocean_mod', 'lunar_outpost_mod',
  ]),
  // 2100: engineered ocean platforms / orbital anchors — intentional non-land tiles.
  era_space_age: new Set([
    'pacific_seasteads', 'arctic_reclamation', 'north_pacific_gyre',
    'south_atlantic_platforms', 'arctic_siberian_shelf', 'equatorial_orbital_anchor',
  ]),
};

interface RawTerritory {
  territory_id: string;
  unlock_era_index?: number;
  geo_config?: unknown[];
  iso_codes?: unknown[];
}

function loadEraMap(mapId: string): { territories: RawTerritory[] } {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8'),
  );
}

function resolvesToRealGeometry(t: RawTerritory): boolean {
  if ((t.geo_config?.length ?? 0) > 0) return true; // inline per-iso config
  if ((t.iso_codes?.length ?? 0) > 0) return true; // inline legacy list
  return hasGeoMapping(t.territory_id); // preset in territoryGeoMapping
}

/**
 * Medieval's seven frontiers were ungated — the whole board is in play from
 * turn one — so it no longer appears in the sweep below. The tiles did not go
 * anywhere and neither does their protection: kamchatka is named in the
 * docstring above as one of the land frontiers that shipped as a gray block
 * once, and it is exactly the tile that would regress unnoticed if this check
 * simply went away with the gate.
 */
const MEDIEVAL_EX_FRONTIERS = [
  'vinland', 'caribbean_isles', 'southern_africa', 'madagascar',
  'australia', 'polynesia', 'kamchatka',
] as const;

describe('medieval ex-frontier geometry (ungated, still must not be blocks)', () => {
  it('every one of the seven resolves to real geometry', () => {
    const map = loadEraMap('era_medieval');
    const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
    // They are base territories now, so assert they are no longer gated AND
    // still draw real geometry — the pair the old sweep gave us for free.
    const stillGated = MEDIEVAL_EX_FRONTIERS.filter((id) => (byId.get(id)?.unlock_era_index ?? 0) > 0);
    expect(stillGated, 'these were ungated deliberately').toEqual([]);

    const missing = MEDIEVAL_EX_FRONTIERS.filter((id) => !byId.has(id));
    expect(missing, 'ungated, not deleted').toEqual([]);

    const blocks = MEDIEVAL_EX_FRONTIERS
      .filter((id) => !resolvesToRealGeometry(byId.get(id)!))
      .map((id) => id);
    expect(blocks, `medieval tiles falling through to a synthetic block: ${blocks.join(', ')}`).toEqual([]);
  });
});

describe('era growth-frontier geometry coverage (no gray blocks)', () => {
  for (const [mapId, allowed] of Object.entries(ALLOWED_SYNTHETIC)) {
    it(`${mapId}: every land frontier resolves to real geometry, not a block`, () => {
      const map = loadEraMap(mapId);
      const frontiers = map.territories.filter((t) => (t.unlock_era_index ?? 0) > 0);
      // Sanity: every growth map actually has frontiers to check.
      expect(frontiers.length).toBeGreaterThan(0);

      // Keep the allowlist honest: every exempted id must be a real frontier here.
      const frontierIds = new Set(frontiers.map((t) => t.territory_id));
      const staleAllowlist = [...allowed].filter((id) => !frontierIds.has(id));
      expect(staleAllowlist, `allowlist ids that are not frontiers on ${mapId}`).toEqual([]);

      const blocks = frontiers
        .filter((t) => !allowed.has(t.territory_id))
        .filter((t) => !resolvesToRealGeometry(t))
        .map((t) => t.territory_id);

      expect(
        blocks,
        `frontiers falling through to a synthetic geo_polygon block: ${blocks.join(', ')}`,
      ).toEqual([]);
    });
  }
});

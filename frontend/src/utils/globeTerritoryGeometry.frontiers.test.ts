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
 * A growth-model game (Ancient start) stays on `era_ancient` and unlocks
 * frontier territories — those with `unlock_era_index > 0` — as it advances.
 * Each frontier resolves geometry in globeTerritoryGeometry.ts via, in order:
 *   1. inline `geo_config` / `iso_codes` on the territory, else
 *   2. a `TERRITORY_GEO_CONFIG` / `TERRITORY_ISO_MAP` preset (hasGeoMapping), else
 *   3. the crude synthetic `geo_polygon` rectangle — the flat gray BLOCK.
 *
 * Several frontiers once shipped with only a placeholder `geo_polygon` and
 * rendered as gray blocks while every base territory drew real coastline. The
 * Discovery-era continents were later split into multiple real-border tiles
 * (north_america_west/east, yukon, azteca; gran_colombia, brazil, peru_chile,
 * rio_plata; insulindia, philippines, malaya). This test asserts every LAND
 * frontier resolves via (1) or (2) so a future frontier can't silently regress
 * to a block. Genuine ocean/ice tiles with no coastline to trace are exempted
 * via ALLOWED_SYNTHETIC (empty today — all Ancient frontiers are land/islands,
 * but kept for future era maps).
 */

// Intentional non-land frontiers that are meant to stay authored polygon blocks
// (open ocean / orbital tiles with no real coastline to trace). Empty for
// era_ancient; documents the escape hatch and the audited ids from other eras.
const ALLOWED_SYNTHETIC = new Set<string>([
  'mid_pacific',
  'weddell_sea',
  'bering_strait',
  'deep_pacific',
  'indian_ocean',
  'nonaligned_oceania',
  'polar_arctic',
  'lunar_outpost_mod',
  'orbital_station_mod',
  'north_pacific_deep_mod',
  'southern_ocean',
]);

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

describe('era growth-frontier geometry coverage (no gray blocks)', () => {
  it('every era_ancient land frontier resolves to real geometry, not a block', () => {
    const map = loadEraMap('era_ancient');
    const frontiers = map.territories.filter((t) => (t.unlock_era_index ?? 0) > 0);
    // Sanity: the growth board actually has frontiers to check.
    expect(frontiers.length).toBeGreaterThan(0);

    const blocks = frontiers
      .filter((t) => !ALLOWED_SYNTHETIC.has(t.territory_id))
      .filter((t) => !resolvesToRealGeometry(t))
      .map((t) => t.territory_id);

    expect(blocks, `frontiers falling through to a synthetic geo_polygon block: ${blocks.join(', ')}`).toEqual([]);
  });
});

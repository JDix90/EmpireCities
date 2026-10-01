/**
 * The public map catalog: the projection of the committed map definitions that
 * is safe and useful to publish as static, crawlable HTML on /maps.
 *
 * Why a generated artifact rather than reading the JSON at build time: the
 * frontend Docker image copies `frontend/`, `packages/shared` and
 * `packages/warfront-sim` and nothing else (docker/Dockerfile.frontend), so
 * `database/maps/*.json` does not exist inside the image that runs the build.
 * Fetching the live API instead would make the build depend on production being
 * reachable. Same reasoning, and same shape, as the faction codex next door in
 * game-engine/eras/factionCodex.ts.
 *
 * Deliberately a PROJECTION, not the raw map: polygons, centre points, canvas
 * dimensions and globe camera settings are rendering internals that would
 * multiply the published file's size by two orders of magnitude and mean
 * nothing to a reader. What is kept is what a map page actually shows — the
 * name, the written setting, how big the board is, and which regions are worth
 * what.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startingBoardRegionSize, startingBoardTerritories } from './startingBoard';

/**
 * The maps that get their OWN page, in the order /maps lists them.
 *
 * Curated by hand, and deliberately not "every public map". A page earns its
 * place by having a real subject someone might search for — the Roman Empire,
 * Sengoku Japan, the Mongol conquests. Generating a page for every map would
 * produce near-identical pages about things nobody looks for, which is what
 * Google's scaled-content-abuse policy is aimed at and is not what this is.
 *
 * So: adding a map to the game does NOT publish a page. Adding it here does,
 * and that should be a decision someone makes on purpose.
 */
export const MAP_PAGE_IDS = [
  'community_roman_empire_117',
  'community_sengoku_japan',
  'community_napoleonic_europe',
  'community_mongol_empire',
  'community_charlemagne_814',
  'community_fractured_china',
  'community_byzantium_megali',
  'community_balkanized_india',
  'community_uncolonized_africa',
  'community_nusantara',
  'community_south_america',
  'community_britain_925',
] as const;

/**
 * The default board for each era, keyed by era id.
 *
 * These get NO page of their own — /eras/:slug is the page, and it quotes its
 * era's board. Listing them here rather than in MAP_PAGE_IDS is the whole
 * distinction: data worth publishing on a page that already exists, versus a
 * page that has to earn its own url.
 */
export const ERA_MAP_IDS = {
  ancient: 'era_ancient',
  medieval: 'era_medieval',
  discovery: 'era_discovery',
  ww2: 'era_ww2',
  coldwar: 'era_coldwar',
  modern: 'era_modern',
  acw: 'era_acw',
  risorgimento: 'era_risorgimento',
  space_age: 'era_space_age',
  galaxy_age: 'era_galaxy',
} as const;

export interface CatalogRegion {
  name: string;
  /** Reinforcements per turn for holding the whole region. */
  bonus: number;
  territory_count: number;
}

export interface CatalogMap {
  /** URL slug: the map_id without its `community_`/`era_` prefix, hyphenated. */
  slug: string;
  map_id: string;
  name: string;
  description: string;
  /** The starting board: what a game on this map opens with (see startingBoard.ts). */
  territory_count: number;
  /** Frontier territories authored for later eras, dealt only through Era Advancement; 0 when none. */
  expansion_territory_count: number;
  /** Regions made entirely of those frontiers; they are left out of `regions`. */
  expansion_region_count: number;
  /** Borders plus sea lanes on the starting board — a rough measure of how open it plays. */
  connection_count: number;
  /** How many of the connections are sea routes rather than land borders. */
  sea_route_count: number;
  era_theme: string;
  regions: CatalogRegion[];
}

interface RawMapRegion {
  region_id?: string;
  name?: string;
  bonus?: number;
  territory_ids?: string[];
}

interface RawMap {
  map_id?: string;
  name?: string;
  description?: string;
  era_theme?: string;
  territories?: { territory_id?: string; region_id?: string; unlock_era_index?: number }[];
  connections?: { from?: string; to?: string; type?: string }[];
  regions?: RawMapRegion[];
}

/** `community_roman_empire_117` → `roman-empire-117`. */
export function slugForMapId(mapId: string): string {
  return mapId.replace(/^(community|era)_/, '').replace(/_/g, '-');
}

/**
 * Project a map the way a player meets it: the STARTING board. Era maps author
 * later-era frontier tiles that a game only deals through Era Advancement
 * (Ancient: 57 authored, 33 dealt), so counting the file promised a bigger
 * board than the one the lobby then started. The frontier total is kept
 * alongside so a page can still say how far the board grows.
 *
 * Region sizes come from startingBoardRegionSize: community maps list members
 * on the region (`territory_ids`); the era boards instead put a `region_id` on
 * each territory and leave the list off, so counting only the list read every
 * era region as 0. A region made entirely of frontiers is left out and counted
 * in `expansion_region_count`, so no page quotes a "+0" region nobody can hold.
 */
function projectMap(raw: RawMap): CatalogMap {
  const mapId = raw.map_id ?? '';
  const authored = raw.territories ?? [];
  const starting = startingBoardTerritories(mapId, authored);
  const onBoard = new Set(starting.map((t) => t.territory_id));
  const connections = (raw.connections ?? []).filter(
    (c) => !c.from || !c.to || (onBoard.has(c.from) && onBoard.has(c.to)),
  );
  const sized = (raw.regions ?? []).map((r) => ({
    name: r.name ?? '',
    bonus: r.bonus ?? 0,
    territory_count: startingBoardRegionSize(mapId, authored, r),
  }));
  const regions = sized.filter((r) => r.territory_count > 0);
  return {
    slug: slugForMapId(mapId),
    map_id: mapId,
    name: raw.name ?? '',
    description: raw.description ?? '',
    territory_count: starting.length,
    expansion_territory_count: authored.length - starting.length,
    expansion_region_count: sized.length - regions.length,
    connection_count: connections.length,
    sea_route_count: connections.filter((c) => c?.type === 'sea').length,
    era_theme: raw.era_theme ?? 'custom',
    regions,
  };
}

/**
 * Read the committed map definitions and project the curated ones.
 *
 * Order follows MAP_PAGE_IDS rather than the directory, because that order is
 * the published one and a filesystem's is not something to publish. A listed id
 * with no file is a hard error: a silently dropped map would be a page that
 * vanishes from the sitemap with nothing to point at.
 */
function readMapsByid(mapsDir: string): Map<string, RawMap> {
  const onDisk = new Map<string, RawMap>();
  for (const file of readdirSync(mapsDir)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(join(mapsDir, file), 'utf8')) as RawMap;
    if (raw.map_id) onDisk.set(raw.map_id, raw);
  }
  return onDisk;
}

export function buildMapCatalog(mapsDir: string): CatalogMap[] {
  const onDisk = readMapsByid(mapsDir);
  return MAP_PAGE_IDS.map((id) => {
    const raw = onDisk.get(id);
    if (!raw) {
      throw new Error(
        `[map-catalog] ${id} is listed in MAP_PAGE_IDS but no map in ${mapsDir} has that map_id`,
      );
    }
    return projectMap(raw);
  });
}

/** The era boards, projected the same way but keyed by era id. */
export function buildEraMaps(mapsDir: string): Record<string, CatalogMap> {
  const onDisk = readMapsByid(mapsDir);
  const out: Record<string, CatalogMap> = {};
  for (const [eraId, mapId] of Object.entries(ERA_MAP_IDS)) {
    const raw = onDisk.get(mapId);
    if (!raw) {
      throw new Error(
        `[map-catalog] era ${eraId} expects ${mapId} but no map in ${mapsDir} has that map_id`,
      );
    }
    out[eraId] = projectMap(raw);
  }
  return out;
}

export function renderMapCatalogModule(
  catalog: CatalogMap[],
  eraMaps: Record<string, CatalogMap>,
): string {
  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: database/maps/*.json, projected by
 * backend/src/modules/maps/mapCatalog.ts.
 * Regenerate: pnpm -C backend exec tsx scripts/generateMapCatalog.ts
 *
 * Committed on purpose: the frontend image does not copy database/, and the
 * build must not depend on the live API. A backend test fails if this drifts
 * from the map definitions, so an edit here would be reverted by the next
 * regeneration.
 */
export const MAP_CATALOG = ${JSON.stringify(catalog, null, 2)};

/** Maps with their own page — for copy that quotes a count. */
export const MAP_PAGE_COUNT = ${catalog.length};

/** The default board for each era, keyed by era id. Used by /eras/:slug. */
export const ERA_MAPS = ${JSON.stringify(eraMaps, null, 2)};
`;
}

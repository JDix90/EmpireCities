/**
 * What "how big is this board" means to a player: the territories in play
 * when a game on it starts.
 *
 * Era maps author later-era frontier tiles (`unlock_era_index > 0`) that only
 * enter play through Era Advancement (see
 * game-engine/eraAdvancement/territoryUnlock.ts), so a file's territory list
 * overstates the board a game actually opens on — Ancient authors 57 tiles and
 * starts on 33. Every public count (the map catalog behind /eras and /maps, the
 * /maps/eras summaries behind the Map Hub, the lobby previews) reads these
 * helpers so they all quote the starting board, with the frontier total
 * alongside it, instead of promising a board the game then does not deal.
 *
 * The standalone Space Age is the documented exception (README, "Playable
 * Eras"): with advancement off and `space_age_frontiers_enabled` on — the code
 * default — its frontiers are seeded neutral from turn one, so its starting
 * board is the whole file (game-engine: seedsFullBoardAtStart).
 */
import { territoryUnlockEra } from '../../game-engine/eraAdvancement/territoryUnlock';

export const FULL_BOARD_AT_START_MAP_IDS: ReadonlySet<string> = new Set(['era_space_age']);

export interface StartingBoardTerritory {
  territory_id?: string;
  region_id?: string;
  unlock_era_index?: number;
}

export interface StartingBoardRegion {
  region_id?: string;
  /** Community maps list a region's members here; era maps tag the territories instead. */
  territory_ids?: string[];
}

export function isOnStartingBoard(mapId: string | undefined, t: StartingBoardTerritory): boolean {
  if (mapId && FULL_BOARD_AT_START_MAP_IDS.has(mapId)) return true;
  return territoryUnlockEra(t) === 0;
}

export function startingBoardTerritories<T extends StartingBoardTerritory>(
  mapId: string | undefined,
  territories: readonly T[],
): T[] {
  return territories.filter((t) => isOnStartingBoard(mapId, t));
}

function regionSize(territories: readonly StartingBoardTerritory[], region: StartingBoardRegion): number {
  if (region.territory_ids) {
    const ids = new Set(territories.map((t) => t.territory_id));
    return region.territory_ids.filter((id) => ids.has(id)).length;
  }
  if (!region.region_id) return 0;
  return territories.filter((t) => t.region_id === region.region_id).length;
}

/** How many of a region's territories are on the starting board. */
export function startingBoardRegionSize(
  mapId: string | undefined,
  territories: readonly StartingBoardTerritory[],
  region: StartingBoardRegion,
): number {
  return regionSize(startingBoardTerritories(mapId, territories), region);
}

/**
 * The regions a starting board has, in authored order: every region except
 * those made entirely of later-era frontiers. A region with no territories at
 * all (an editor draft, a bare fixture) is kept — it is not a frontier, just
 * empty, and the summary should count what the author listed.
 */
export function startingBoardRegions<R extends StartingBoardRegion>(
  mapId: string | undefined,
  territories: readonly StartingBoardTerritory[],
  regions: readonly R[],
): R[] {
  return regions.filter(
    (r) => regionSize(territories, r) === 0 || startingBoardRegionSize(mapId, territories, r) > 0,
  );
}

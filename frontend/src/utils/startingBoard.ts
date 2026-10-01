/**
 * The territories a game on this map starts with.
 *
 * Era maps author later-era frontier tiles (`unlock_era_index > 0`) that only
 * enter play through Era Advancement, so `map.territories.length` overstates
 * the board a game opens on (Ancient: 57 authored, 33 dealt). The server
 * projects the map it sends a live game; the lobby and Map Hub previews fetch
 * the full file over REST and count it here instead, so every count a player
 * sees before a game matches the board they get.
 *
 * Mirrors backend/src/modules/maps/startingBoard.ts, including its one
 * exception: the standalone Space Age seeds its frontiers neutral from turn
 * one (the `space_age_frontiers_enabled` default), so its whole file is the
 * starting board.
 */
export const FULL_BOARD_AT_START_MAP_IDS: ReadonlySet<string> = new Set(['era_space_age']);

export interface StartingBoardMapLike {
  map_id?: string;
  territories: ReadonlyArray<{ unlock_era_index?: number }>;
}

export function isOnStartingBoard(mapId: string | undefined, t: { unlock_era_index?: number }): boolean {
  if (mapId && FULL_BOARD_AT_START_MAP_IDS.has(mapId)) return true;
  return (t.unlock_era_index ?? 0) <= 0;
}

export function startingBoardTerritoryCount(map: StartingBoardMapLike): number {
  return map.territories.filter((t) => isOnStartingBoard(map.map_id, t)).length;
}

/**
 * Which territories count toward a region's bonus: the ones on the board.
 *
 * A growing map (Era Advancement) holds some territories out until an era
 * unlocks them. Those neither count toward holding a region nor stop it
 * paying: a region pays whoever holds every one of its territories that is on
 * the board. And a region pays only with at least MIN_REGION_TERRITORIES of
 * them there, so one territory alone is never a region, on a growing board
 * before its second territory unlocks or on a map that authored one.
 *
 * The turn-start draft, the bots' forecasts, goals and picks, the coaching
 * tips and the daily puzzle model all read regions through this rule; the
 * client's territory panel mirrors it (frontend/src/utils/continentBonus.ts).
 */
import type { GameMap } from '../../types';

/**
 * A region pays only with at least this many of its territories on the board.
 * Keep in sync with frontend/src/utils/continentBonus.ts.
 */
export const MIN_REGION_TERRITORIES = 2;

/**
 * Each region's territories on the board, for every region with at least
 * MIN_REGION_TERRITORIES of them there; a region with fewer pays nobody and is
 * left out. `onBoard` is the game's territories (state.territories).
 */
export function regionsOnBoard(
  map: Pick<GameMap, 'territories' | 'regions'>,
  onBoard: Record<string, unknown>,
): Map<string, string[]> {
  const byRegion = new Map<string, string[]>();
  for (const t of map.territories) {
    if (onBoard[t.territory_id] === undefined) continue;
    const ids = byRegion.get(t.region_id);
    if (ids) ids.push(t.territory_id);
    else byRegion.set(t.region_id, [t.territory_id]);
  }
  for (const [regionId, ids] of byRegion) {
    if (ids.length < MIN_REGION_TERRITORIES) byRegion.delete(regionId);
  }
  return byRegion;
}

/**
 * Each region's bonus where it can pay on this board, and 0 where it cannot:
 * for the heuristics that rank ground by the region it lies in (a bot's
 * territory-selection picks).
 */
export function payableRegionBonuses(
  map: Pick<GameMap, 'territories' | 'regions'>,
  onBoard: Record<string, unknown>,
): Record<string, number> {
  const payable = regionsOnBoard(map, onBoard);
  const bonuses: Record<string, number> = {};
  for (const r of map.regions) bonuses[r.region_id] = payable.has(r.region_id) ? r.bonus : 0;
  return bonuses;
}

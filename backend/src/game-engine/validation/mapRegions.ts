/**
 * Offline validation for a map's regions (seed files and editor output).
 *
 * A region pays only with at least MIN_REGION_TERRITORIES of its territories
 * on the board (state/regionsOnBoard.ts), so a bonus region authored with
 * fewer can never pay: the bonus is a promise the game does not keep. Two
 * kinds of region may hold a single territory:
 *
 * - one with no bonus, which promises nothing (a landmark);
 * - a faction's home. It never pays in play either, but the faction deal
 *   (gameStateManager distributeTerritoriesGeographic) weighs its bonus when it
 *   shares out the board, so changing it re-deals that era's faction games and
 *   campaign stages. The UK's British Isles is one: its +2 set to 0 took The
 *   Last Defenders' WW2 stage from a 42% to an 11% stand-in win rate.
 */
import { MIN_REGION_TERRITORIES } from '../state/regionsOnBoard';

export interface MapRegionDocument {
  territories: Array<{ territory_id: string; region_id?: string }>;
  regions?: Array<{ region_id: string; bonus?: number; territory_ids?: string[] }>;
}

/**
 * Human-readable errors; empty means valid. `homeRegionIds` are the map era's
 * faction homes (Faction.home_region_ids).
 */
export function validateMapRegions(
  map: MapRegionDocument,
  homeRegionIds: ReadonlySet<string> = new Set(),
): string[] {
  const errors: string[] = [];
  const count = new Map<string, number>();
  for (const t of map.territories) {
    if (t.region_id) count.set(t.region_id, (count.get(t.region_id) ?? 0) + 1);
  }
  for (const r of map.regions ?? []) {
    if ((r.bonus ?? 0) <= 0 || homeRegionIds.has(r.region_id)) continue;
    // Community maps list a region's members; era maps tag the territories.
    const size = r.territory_ids ? r.territory_ids.length : count.get(r.region_id) ?? 0;
    if (size < MIN_REGION_TERRITORIES) {
      errors.push(
        `Region "${r.region_id}" has a +${r.bonus} bonus but ${size} territor${size === 1 ? 'y' : 'ies'}: `
          + `a region pays only with ${MIN_REGION_TERRITORIES} or more. Fold it into a neighbouring region, or set its bonus to 0 `
          + "(a faction's home may keep its bonus: see validation/mapRegions.ts).",
      );
    }
  }
  return errors;
}

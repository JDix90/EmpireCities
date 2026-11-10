import type { GameMap, TerritoryState } from '../../types';

/**
 * A player's first match starts fair (`first_match_fair_start_enabled`).
 *
 * The first match is one Easy bot on Britain 925: 14 territories in four
 * regions, two of them only two territories each, dealt 7/7 at random. In
 * bot-against-bot runs on that map, who moved first won 57% to 43%, and a seat
 * dealt more region bonus than its rival won 75% to 26%, a quarter of the time
 * weighting the game three to one before anyone moved. A newcomer meets that
 * coin before they know there is one. So in a game tagged `first_match`, the
 * human moves first and the deal is redone until no seat holds a whole
 * region.
 */

/** Redeals before giving up and keeping the last one. On Britain about one deal in four is clean. */
export const FAIR_DEAL_ATTEMPTS = 200;

/**
 * True when some player owns every dealt territory of a region that pays a
 * bonus. Only territories in `dealtIds` count, so tiles held back from the deal
 * (lunar ground) cannot make a region look split.
 */
export function anyWholeRegionDealt(
  territories: Record<string, TerritoryState>,
  map: Pick<GameMap, 'territories' | 'regions'>,
  dealtIds: readonly string[],
): boolean {
  const dealt = new Set(dealtIds);
  const paying = new Set(map.regions.filter((r) => r.bonus > 0).map((r) => r.region_id));
  const ownersByRegion = new Map<string, Set<string | null>>();
  for (const t of map.territories) {
    if (!dealt.has(t.territory_id) || !paying.has(t.region_id)) continue;
    const owners = ownersByRegion.get(t.region_id) ?? new Set<string | null>();
    owners.add(territories[t.territory_id]?.owner_id ?? null);
    ownersByRegion.set(t.region_id, owners);
  }
  for (const owners of ownersByRegion.values()) {
    if (owners.size === 1 && !owners.has(null)) return true;
  }
  return false;
}

/** The seat that moves first in a fair first match: the human's (the host is seat 0, but don't assume it). */
export function fairFirstMatchStartingIndex(players: readonly { is_ai?: boolean }[]): number | null {
  const human = players.findIndex((p) => !p.is_ai);
  return human >= 0 ? human : null;
}

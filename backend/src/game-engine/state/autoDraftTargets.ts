import type { GameMap, GameState } from '../../types';
import { isFriendlyOwner } from './teams';
import { getWorldRules } from './worldRules';

/**
 * The order auto-placement fills a player's territories in when it stacks
 * (`auto_place_stack_enabled`, see `autoPlaceDraftUnits`).
 *
 * Spreading one unit per territory round-robin, as auto-placement did, left
 * nothing strong enough to attack with or to hold a border: a player who only
 * ever pressed the phase button lost every simulated first match against one
 * Easy bot. Stacking puts the units where a bot would put them.
 *
 * Border territories come first — ground with a neighbour that is neither the
 * player's nor an ally's (neutral ground counts, as it does for the bots) —
 * most threatened first, scored as the bots score their draft
 * (ai/aiBot.ts `selectDraftTarget`): the units on that ground next door. That
 * score without the bots' jitter, goal staging or faction weighting, so the
 * same board always gives the same placement. Ties go to the bigger stack,
 * then to `territory_id`. A border at or past its world's storm threshold
 * (Galactic Age) goes after the other borders, as the bots skip it: stacking
 * there only feeds the weather. Interior territories follow, by id, for when
 * every border has hit its stability cap.
 */
export function autoDraftStackOrder(state: GameState, map: GameMap, playerId: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const conn of map.connections) {
    if (!adjacency.has(conn.from)) adjacency.set(conn.from, []);
    if (!adjacency.has(conn.to)) adjacency.set(conn.to, []);
    adjacency.get(conn.from)!.push(conn.to);
    adjacency.get(conn.to)!.push(conn.from);
  }

  type Border = { tid: string; threat: number; units: number; stormed: boolean };
  const borders: Border[] = [];
  const interior: string[] = [];
  for (const [tid, territory] of Object.entries(state.territories)) {
    if (territory.owner_id !== playerId) continue;
    const enemyNeighbors = (adjacency.get(tid) ?? []).filter(
      (nid) => state.territories[nid] && !isFriendlyOwner(state, playerId, state.territories[nid]!.owner_id),
    );
    if (enemyNeighbors.length === 0) {
      interior.push(tid);
      continue;
    }
    const stormThreshold = getWorldRules(state, territory.world_id).storm_threshold;
    borders.push({
      tid,
      threat: enemyNeighbors.reduce((sum, nid) => sum + Math.max(0, state.territories[nid]!.unit_count), 0),
      units: territory.unit_count,
      stormed: stormThreshold != null && territory.unit_count >= stormThreshold,
    });
  }

  borders.sort((a, b) =>
    Number(a.stormed) - Number(b.stormed)
    || b.threat - a.threat
    || b.units - a.units
    || a.tid.localeCompare(b.tid),
  );
  return [...borders.map((b) => b.tid), ...interior.sort()];
}

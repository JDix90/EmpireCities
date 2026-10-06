/**
 * Fog of war: what a seat may see.
 *
 * Under `fog_of_war` a player sees the exact intel (units, fleets, buildings,
 * garrison doctrine, stability, population) of their own territories, every
 * territory bordering them, and whatever recon or a faction passive reveals;
 * everywhere else they see only who holds it. They never see a rival's hand.
 *
 * The live game's `game:state` (sockets/gameSocket.ts buildClientState) and
 * map visuals read visibility from here. A bot plans and chooses its targets
 * on the board as its seat sees it: in a live game, the `game:state` a human
 * in that seat would receive; in a harness, {@link seatView}, the same board
 * without the payload's transport-only extras. Either way a bot under fog
 * knows what a human in its seat would.
 */
import type { GameMap, GameState, TerritoryState } from '../../types';
import { expandFogVisibilityFromFactionPassive, expandFogVisibilityFromRecon } from '../abilities/techAbilities';
import { maskHiddenTerritories, redactPlayersForViewer } from '../../sockets/clientStateRedaction';
import { sideOf } from './teams';

/**
 * A garrison a seat cannot see counts as this many units when it chooses a
 * target: not none, which would make every hidden tile the weakest on the
 * board, and not its true size, which fog hides.
 */
export const HIDDEN_UNITS = 3;

/** A territory's units as a seat sees them: {@link HIDDEN_UNITS} when fog masks them. */
export function seenUnits(t: Pick<TerritoryState, 'unit_count'>): number {
  return t.unit_count >= 0 ? t.unit_count : HIDDEN_UNITS;
}

/**
 * Territories whose exact intel a player may see in a fog game: their side's
 * own (shared vision in a team game), everything bordering them, and whatever
 * recon or a faction passive reveals. Without `adjacency` only the side's own.
 */
export function fogVisibleTerritoryIds(
  state: GameState,
  playerId: string,
  adjacency: Map<string, string[]> | undefined,
): Set<string> {
  // Shared vision in a team game (state/teams.ts): a player sees whatever any
  // ally sees. Alone in a free-for-all game, the side is just the player.
  const side = sideOf(state, playerId);
  const visibleIds = new Set<string>();
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id && side.includes(tState.owner_id)) visibleIds.add(tid);
  }
  if (adjacency) {
    for (const tid of Array.from(visibleIds)) {
      for (const neighbour of adjacency.get(tid) ?? []) visibleIds.add(neighbour);
    }
    for (const id of side) {
      expandFogVisibilityFromRecon(state, id, visibleIds, adjacency);
      expandFogVisibilityFromFactionPassive(state, id, visibleIds, adjacency);
    }
  }
  return visibleIds;
}

/** The map's adjacency, both directions of every connection. */
export function fogAdjacency(map: GameMap): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const conn of map.connections) {
    if (!adj.has(conn.from)) adj.set(conn.from, []);
    if (!adj.has(conn.to)) adj.set(conn.to, []);
    adj.get(conn.from)!.push(conn.to);
    adj.get(conn.to)!.push(conn.from);
  }
  return adj;
}

/**
 * The board as a seat sees it: with fog of war on, every territory it cannot
 * see is masked (`unit_count: -1`, no fleets or buildings), every other
 * player's hand is empty and their secret mission withheld, as in the
 * `game:state` a human in that seat receives. Without fog, the state itself.
 *
 * A view, never a copy to change: masked territories and redacted players are
 * fresh objects, everything else is the state's own.
 */
export function seatView(
  state: GameState,
  map: GameMap,
  playerId: string,
  adjacency: Map<string, string[]> = fogAdjacency(map),
): GameState {
  if (!state.settings.fog_of_war) return state;
  const visible = fogVisibleTerritoryIds(state, playerId, adjacency);
  return {
    ...state,
    territories: maskHiddenTerritories(state.territories, visible),
    players: redactPlayersForViewer(
      state.players.map((p) => (p.player_id === playerId ? p : { ...p, cards: [] })),
      playerId,
      state.phase,
    ),
  };
}

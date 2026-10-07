import type { GameMap, GameState, MapConnection, PlayerState } from '../../types';
import {
  fortifyEndpointsRequireOrbitAccess,
  fortifyTraversalFilter,
  getOrbitAccessResult,
  isLaneSealedForPlayer,
} from './moonAccess';

/**
 * BFS over territories the player owns. `canTraverse` optionally rejects
 * individual connections: fortify passes a filter that refuses orbit lanes the
 * player cannot currently cross, so a multi-hop route cannot smuggle troops
 * across a lane whose two endpoints are not the fortify's own endpoints.
 */
export function pathExists(
  fromId: string,
  toId: string,
  state: GameState,
  map: GameMap,
  ownerId: string,
  canTraverse?: (conn: MapConnection) => boolean
): boolean {
  const adj: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adj[conn.from]) adj[conn.from] = [];
    if (!adj[conn.to]) adj[conn.to] = [];
    if (canTraverse && !canTraverse(conn)) continue;
    adj[conn.from].push(conn.to);
    adj[conn.to].push(conn.from);
  }

  const visited = new Set<string>();
  const queue = [fromId];
  visited.add(fromId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) return true;
    for (const neighbor of (adj[current] ?? [])) {
      if (!visited.has(neighbor) && state.territories[neighbor]?.owner_id === ownerId) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}

/**
 * Whether a fortify between two of the player's tiles has a route a player's
 * move would be allowed (sockets/gameSocket.ts `game:fortify`): a path over
 * the player's own ground that refuses orbit lanes it cannot cross, and, when
 * the move's own endpoints are on different worlds, the orbit gate open and
 * the lane between them unsealed. A bot's fortify takes this rule. Drift Jump,
 * the one route a player has without a path, is a player's choice and not
 * offered here.
 */
export function fortifyRouteAllowed(
  state: GameState,
  map: GameMap,
  player: PlayerState,
  fromId: string,
  toId: string,
): boolean {
  if (!pathExists(fromId, toId, state, map, player.player_id, fortifyTraversalFilter(state, player, map, state.era))) {
    return false;
  }
  if (fortifyEndpointsRequireOrbitAccess(map, state.era, fromId, toId)) {
    if (!getOrbitAccessResult(state, player, map, state.era).allowed) return false;
    if (isLaneSealedForPlayer(state, fromId, toId, player.player_id)) return false;
  }
  return true;
}

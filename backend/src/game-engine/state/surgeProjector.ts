// ============================================================
// Surge Projector — a one-crossing lane across a ring gap
// ============================================================
//
// The fourth Galactic Age lane power (abilities/lanePowers.ts,
// docs/GALACTIC_AGE_BUILDINGS.md §6). A player holding Jump Gates on both
// worlds of a gap in the authored ring, and the gateway at one end of that gap,
// pays 10 PP to open the gap to the rival gateway at the other end for ONE
// crossing, this attack phase only.
//
// Like a Lane Surge (laneWeather.ts) the lane is state, projected onto the
// game's map copy as an orbit connection, so the attack path, the lane dice cap
// and the chart all see an ordinary lane. Unlike one it is private and short:
// it is live only while its owner is in the attack phase, holds the near
// gateway and has not yet taken the far one. The capture IS the crossing, so it
// closes the lane, which can then carry neither a second assault nor a fortify.
//
// `syncSurgeProjectorLanes` drops the lane from state and from the map the
// moment it stops being live. The socket calls it after the power fires, after
// every capture, as the attack phase ends and after every turn advance; the
// engine also clears it in `advanceToNextPlayer`, so no path can carry it into
// another seat's turn.
//
// Why the gap and not any lane: attack-carrying Jump Gate lanes paid the
// leader by 13 points (jumpGates.ts). One crossing at a price is a much smaller
// thing than a permanent lane, which is why it has its own sim arm.

import type { GameMap, GameState, MapConnection } from '../../types';
import { orbitLaneId } from './moonAccess';

export const SURGE_PROJECTOR_LANE_SOURCE = 'surge_projector' as const;

/** True while the projected lane still carries its owner's crossing. */
export function isSurgeProjectorLaneLive(state: GameState): boolean {
  const lane = state.surge_projector_lane;
  if (!lane) return false;
  if (state.phase !== 'attack') return false;
  if (state.players[state.current_player_index]?.player_id !== lane.owner_id) return false;
  if (state.territories[lane.from]?.owner_id !== lane.owner_id) return false;
  const far = state.territories[lane.to]?.owner_id;
  return !!far && far !== lane.owner_id;
}

/** The lane the live projector should produce (none once it has closed). */
export function surgeProjectorConnections(state: GameState): MapConnection[] {
  const lane = state.surge_projector_lane;
  if (!lane || !isSurgeProjectorLaneLive(state)) return [];
  return [{ from: lane.from, to: lane.to, type: 'orbit', source: SURGE_PROJECTOR_LANE_SOURCE }];
}

/**
 * Drop a lane that has closed from state, and bring the map copy in line:
 * add the live lane, remove a closed one. Replaces the array rather than
 * mutating it (consumers cache adjacency on `map.connections` identity), as
 * `syncLaneWeatherLanes` does. Returns true when the map changed.
 */
export function syncSurgeProjectorLanes(map: GameMap, state: GameState): boolean {
  if (state.surge_projector_lane && !isSurgeProjectorLaneLive(state)) state.surge_projector_lane = undefined;
  const wanted = surgeProjectorConnections(state);
  const wantedKeys = new Set(wanted.map((c) => orbitLaneId(c.from, c.to)));
  const existing = map.connections.filter((c) => c.source === SURGE_PROJECTOR_LANE_SOURCE);
  const existingKeys = new Set(existing.map((c) => orbitLaneId(c.from, c.to)));
  const stale = existing.filter((c) => !wantedKeys.has(orbitLaneId(c.from, c.to)));
  const missing = wanted.filter((c) => !existingKeys.has(orbitLaneId(c.from, c.to)));
  if (stale.length === 0 && missing.length === 0) return false;
  map.connections = [
    ...map.connections.filter((c) => c.source !== SURGE_PROJECTOR_LANE_SOURCE || wantedKeys.has(orbitLaneId(c.from, c.to))),
    ...missing,
  ];
  return true;
}

/** Every edge between `a` and `b` is a projected lane (none is authored). */
export function isSurgeProjectorOnlyEdge(map: GameMap, a: string, b: string): boolean {
  const edges = map.connections.filter((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
  return edges.length > 0 && edges.every((c) => c.source === SURGE_PROJECTOR_LANE_SOURCE);
}

/** Does the live projected lane carry this player's attack from `from` into `to`? */
export function surgeProjectorCarries(state: GameState, playerId: string, from: string, to: string): boolean {
  const lane = state.surge_projector_lane;
  return !!lane && lane.owner_id === playerId && lane.from === from && lane.to === to && isSurgeProjectorLaneLive(state);
}

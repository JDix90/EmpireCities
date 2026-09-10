// ============================================================
// Jump Gates — lanes the players build themselves
// ============================================================
//
// The Galactic Age's map is the thing being fought over, and the Jump Gate is
// where that becomes literal: build one on a world you hold, build another on a
// different world, and the pair is joined by a private hyperspace lane: a road
// for your own armies between two worlds, and a 12-PP asset the moment someone
// takes one end, because the lane dies with it.
//
// Why the links are STATE and not derived from ownership: the design promise is
// "the lane exists while both buildings stand … an enemy who captures a gate tile
// inherits that end". A pairing recomputed from current owners would instead
// delete the lane at the instant of capture, which is the opposite of a liability.
// So a pair is recorded when the second gate is BUILT (`recordJumpGateLinks`) and
// survives until one of its buildings is gone (`syncJumpGateLanes`).
//
// What a gate lane does NOT do is carry an attack. Measured with gate lanes
// fighting like authored ones (200g, seed A) the mechanic paid the leader: the
// turn-10 leader's win rate went 55% → 68%, games fell to 25.7 turns, Sol rose to
// 38% and the Forge Syndicate — whose gates these are — fell to 13.5%, because a
// mobility mechanic erodes exactly the positional defence a turtle lives on. As
// logistics it does the opposite: it shuttles defenders to where the blow lands.
// So a Jump Gate lane moves your own units and nothing else, which also keeps the
// authored ring the only place the war is actually fought.
//
// Lane Sovereignty deliberately ignores these lanes — see victory/laneSovereignty.ts.

import type { GameMap, GameState, MapConnection } from '../../types';

export const JUMP_GATE_BUILDING = 'jump_gate';
export const JUMP_GATE_LANE_SOURCE = 'jump_gate';

/** Base production cost, before the world modifier and any faction discount. */
export const JUMP_GATE_COST = 12;

/** Canonical, order-independent key for a pair of gate tiles. */
function linkKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function hasGate(state: GameState, territoryId: string): boolean {
  return state.territories[territoryId]?.buildings?.includes(JUMP_GATE_BUILDING) ?? false;
}

/** Territory ids carrying a Jump Gate, owned by `playerId`, sorted. */
export function playerGateTerritoryIds(state: GameState, playerId: string): string[] {
  return Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === playerId && (t.buildings?.includes(JUMP_GATE_BUILDING) ?? false))
    .map(([id]) => id)
    .sort();
}

/** True when this player already holds a gate on `worldId` (the one-per-world build rule). */
export function playerHasGateOnWorld(
  state: GameState,
  playerId: string,
  worldId: string | undefined,
  exceptTerritoryId?: string,
): boolean {
  if (!worldId) return false;
  return Object.entries(state.territories).some(
    ([id, t]) =>
      id !== exceptTerritoryId
      && t.owner_id === playerId
      && t.world_id === worldId
      && (t.buildings?.includes(JUMP_GATE_BUILDING) ?? false),
  );
}

/**
 * A gate has just been built on `territoryId` by `playerId`: pair it with every
 * other gate they hold on a DIFFERENT world. Pure state — no map needed, because
 * a territory carries its own `world_id`. Idempotent.
 */
export function recordJumpGateLinks(state: GameState, playerId: string, territoryId: string): void {
  if (!hasGate(state, territoryId)) return;
  const world = state.territories[territoryId]?.world_id;
  const links = state.jump_gate_links ?? [];
  const seen = new Set(links.map((l) => linkKey(l.a, l.b)));
  for (const other of playerGateTerritoryIds(state, playerId)) {
    if (other === territoryId) continue;
    const otherWorld = state.territories[other]?.world_id;
    // Same world (or a map with no worlds at all) buys nothing: the tiles are
    // already connected by land, and the one-per-world rule makes it unreachable.
    if (!world || !otherWorld || otherWorld === world) continue;
    const key = linkKey(territoryId, other);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(territoryId < other ? { a: territoryId, b: other } : { a: other, b: territoryId });
  }
  if (links.length > 0) state.jump_gate_links = links;
}

/** The lanes the current link list should produce. */
export function jumpGateLaneConnections(state: GameState): MapConnection[] {
  return (state.jump_gate_links ?? [])
    .filter((l) => hasGate(state, l.a) && hasGate(state, l.b))
    .map((l) => ({ from: l.a, to: l.b, type: 'orbit' as const, source: JUMP_GATE_LANE_SOURCE }));
}

/**
 * Bring the game's map copy in line with its Jump Gates: add lanes for new pairs,
 * drop lanes (and their links) once either building is gone — an atom bomb clears
 * buildings, and a razed gate should take its lane with it. Runs after each build
 * and on room load, so a room rehydrated from the authored map regains its lanes.
 * Returns true when the map changed.
 *
 * Mirrors `syncLaunchPadLanes`, including the replace-don't-mutate discipline:
 * consumers cache adjacency keyed on `map.connections` identity.
 */
export function syncJumpGateLanes(map: GameMap, state: GameState): boolean {
  const links = state.jump_gate_links ?? [];
  const live = links.filter((l) => hasGate(state, l.a) && hasGate(state, l.b));
  if (live.length !== links.length) {
    state.jump_gate_links = live.length > 0 ? live : undefined;
  }
  const wanted = jumpGateLaneConnections(state);
  const wantedKeys = new Set(wanted.map((c) => linkKey(c.from, c.to)));
  const existing = map.connections.filter((c) => c.source === JUMP_GATE_LANE_SOURCE);
  const existingKeys = new Set(existing.map((c) => linkKey(c.from, c.to)));
  const stale = existing.filter((c) => !wantedKeys.has(linkKey(c.from, c.to)));
  const missing = wanted.filter((c) => !existingKeys.has(linkKey(c.from, c.to)));
  if (stale.length === 0 && missing.length === 0) return false;
  const staleKeys = new Set(stale.map((c) => linkKey(c.from, c.to)));
  map.connections = [
    ...map.connections.filter(
      (c) => c.source !== JUMP_GATE_LANE_SOURCE || !staleKeys.has(linkKey(c.from, c.to)),
    ),
    ...missing,
  ];
  return true;
}

/**
 * True when every connection between these two territories is a Jump Gate lane —
 * i.e. the only way across is the gate, so an attack must be refused.
 */
export function isJumpGateOnlyEdge(map: GameMap, a: string, b: string): boolean {
  const edges = map.connections.filter(
    (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
  );
  return edges.length > 0 && edges.every((c) => c.source === JUMP_GATE_LANE_SOURCE);
}

/** The other end of every live gate lane touching `territoryId`. */
export function jumpGatePartners(state: GameState, territoryId: string): string[] {
  return jumpGateLaneConnections(state)
    .filter((c) => c.from === territoryId || c.to === territoryId)
    .map((c) => (c.from === territoryId ? c.to : c.from));
}

// ============================================================
// Lane weather — the event deck rewrites the graph
// ============================================================
//
// Earth's geography cannot change. A galaxy's can, and this is the cheapest way
// to prove it: two event effects that edit the map for two rounds.
//
//   Nebula Closure — one authored lane shuts to EVERYONE. Not a seal: nobody
//       owns it, no faction charge lifts it, and it ages with the round rather
//       than with a player's turn.
//   Lane Surge     — a temporary lane opens between two worlds the ring does not
//       join, so two players who were never neighbours suddenly are.
//
// Both live in `state.lane_weather` and are ticked once per ROUND in
// `advanceToNextPlayer`. A surge is projected onto the game's map copy as a
// `source: 'lane_surge'` orbit connection by `syncLaneWeatherLanes`, the same
// discipline Launch Pad and Jump Gate lanes use — which also means Lane
// Sovereignty ignores it (it counts authored lanes only) and an attack across it
// obeys every corridor rule, because as far as the resolver is concerned it is
// just another lane while it lasts.

import type { EventEffectResult, GameMap, GameState, MapConnection } from '../../types';
import { authoredLanes, GALAXY_MODE_LANE_SOURCE, gatewaysByWorld, ringGapLanes } from './galaxyRing';
import { orbitLaneId } from './moonAccess';

/** Rounds a closure or a surge lasts. Two: long enough to plan around, short enough to wait out. */
export const LANE_WEATHER_DURATION = 2;

export const LANE_SURGE_LANE_SOURCE = 'lane_surge';

function weather(state: GameState): NonNullable<GameState['lane_weather']> {
  if (!state.lane_weather) state.lane_weather = {};
  return state.lane_weather;
}

/** True when weather has this lane shut — for everyone, including its gateways' owners. */
export function isLaneClosedByWeather(state: GameState, fromId: string, toId: string): boolean {
  const left = state.lane_weather?.closures?.[orbitLaneId(fromId, toId)];
  return left != null && left > 0;
}

/**
 * Nebula Closure: shut one authored lane to everyone for two rounds. Picks the
 * most-contested open lane (the two gateways' owners differ), because closing a
 * lane nobody is fighting over is not an event. Deterministic given the state.
 */
export function applyLaneClosure(state: GameState, map: GameMap): EventEffectResult {
  const open = authoredLanes(map).filter((c) => !isLaneClosedByWeather(state, c.from, c.to));
  if (open.length === 0) return {};
  const scored = open
    .map((c) => {
      const a = state.territories[c.from]?.owner_id ?? null;
      const b = state.territories[c.to]?.owner_id ?? null;
      const contested = a !== null && b !== null && a !== b ? 1 : 0;
      const units = (state.territories[c.from]?.unit_count ?? 0) + (state.territories[c.to]?.unit_count ?? 0);
      return { c, score: contested * 1000 + units };
    })
    .sort((x, y) => y.score - x.score || (orbitLaneId(x.c.from, x.c.to) < orbitLaneId(y.c.from, y.c.to) ? -1 : 1));
  const pick = scored[0].c;
  const w = weather(state);
  w.closures = { ...(w.closures ?? {}), [orbitLaneId(pick.from, pick.to)]: LANE_WEATHER_DURATION };
  return { lane_weather: { kind: 'closure', from: pick.from, to: pick.to, rounds: LANE_WEATHER_DURATION } };
}

/** Lanes the board mode keeps open all game (Colonies at three seats), by lane id. */
function permanentLaneIds(map: GameMap): Set<string> {
  return new Set(
    map.connections.filter((c) => c.source === GALAXY_MODE_LANE_SOURCE).map((c) => orbitLaneId(c.from, c.to)),
  );
}

/**
 * True when a Lane Surge has somewhere to open on this map: a gap in the ring
 * the board mode does not already keep open. A three-seat Colonies board has
 * bridged both for good, so the round's draw leaves the card out rather than
 * deal a surge that does nothing.
 */
export function laneSurgeHasGap(map: GameMap): boolean {
  if (gatewaysByWorld(map).size < 3) return false; // every world already borders every other
  const permanent = permanentLaneIds(map);
  return ringGapLanes(map).some(({ from, to }) => !permanent.has(orbitLaneId(from, to)));
}

/**
 * Lane Surge: open a temporary lane between two worlds the ring does not join,
 * so two players who were never neighbours are — for two rounds. Joins the
 * gateway tiles of each world, so the surge lands where the infrastructure is.
 */
export function applyLaneSurge(state: GameState, map: GameMap): EventEffectResult {
  if (gatewaysByWorld(map).size < 3) return {}; // every world already borders every other
  const live = new Set((state.lane_weather?.surges ?? []).map((s) => orbitLaneId(s.from, s.to)));
  // A gap the board mode keeps open all game needs no surge.
  const permanent = permanentLaneIds(map);
  for (const { from, to } of ringGapLanes(map)) {
    const id = orbitLaneId(from, to);
    if (live.has(id) || permanent.has(id)) continue;
    const w = weather(state);
    w.surges = [...(w.surges ?? []), { from, to, turns_remaining: LANE_WEATHER_DURATION }];
    return { lane_weather: { kind: 'surge', from, to, rounds: LANE_WEATHER_DURATION } };
  }
  return {};
}

/**
 * Once per ROUND: age every closure and surge, dropping what has run out. Called
 * from `advanceToNextPlayer`'s round wrap, beside the event draw — weather is
 * weather, not a player's charge, so it does not wait on whose turn it is.
 * Returns true when anything expired (the caller re-syncs the map).
 */
export function tickLaneWeather(state: GameState): boolean {
  const w = state.lane_weather;
  if (!w) return false;
  let changed = false;
  if (w.closures) {
    const next: Record<string, number> = {};
    for (const [laneId, left] of Object.entries(w.closures)) {
      const remaining = left - 1;
      if (remaining > 0) next[laneId] = remaining;
      else changed = true;
    }
    w.closures = Object.keys(next).length > 0 ? next : undefined;
  }
  if (w.surges) {
    const next = w.surges
      .map((s) => ({ ...s, turns_remaining: s.turns_remaining - 1 }))
      .filter((s) => s.turns_remaining > 0);
    if (next.length !== w.surges.length) changed = true;
    w.surges = next.length > 0 ? next : undefined;
  }
  if (!w.closures && !w.surges) state.lane_weather = undefined;
  return changed;
}

/** The lanes the live surges should produce. */
export function laneSurgeConnections(state: GameState): MapConnection[] {
  return (state.lane_weather?.surges ?? []).map((s) => ({
    from: s.from,
    to: s.to,
    type: 'orbit' as const,
    source: LANE_SURGE_LANE_SOURCE,
  }));
}

/**
 * Bring the game's map copy in line with the live surges: add lanes that opened,
 * drop lanes that blew over. Mirrors `syncLaunchPadLanes` / `syncJumpGateLanes`,
 * including replacing the array rather than mutating it (consumers cache
 * adjacency keyed on `map.connections` identity). Returns true when it changed.
 */
export function syncLaneWeatherLanes(map: GameMap, state: GameState): boolean {
  const wanted = laneSurgeConnections(state);
  const wantedKeys = new Set(wanted.map((c) => orbitLaneId(c.from, c.to)));
  const existing = map.connections.filter((c) => c.source === LANE_SURGE_LANE_SOURCE);
  const existingKeys = new Set(existing.map((c) => orbitLaneId(c.from, c.to)));
  const stale = existing.filter((c) => !wantedKeys.has(orbitLaneId(c.from, c.to)));
  const missing = wanted.filter((c) => !existingKeys.has(orbitLaneId(c.from, c.to)));
  if (stale.length === 0 && missing.length === 0) return false;
  const staleKeys = new Set(stale.map((c) => orbitLaneId(c.from, c.to)));
  map.connections = [
    ...map.connections.filter(
      (c) => c.source !== LANE_SURGE_LANE_SOURCE || !staleKeys.has(orbitLaneId(c.from, c.to)),
    ),
    ...missing,
  ];
  return true;
}

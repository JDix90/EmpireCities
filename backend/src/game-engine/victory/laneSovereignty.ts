// ============================================================
// Lane Sovereignty — the galaxy's own victory condition
// ============================================================
//
// Every other way to win this game counts tiles. Sovereignty counts CONNECTIONS:
// hold both gateways of five of the eight authored hyperspace lanes at the start
// of your turn, three turns running (five in a two-player game), and the network
// is yours. It rewards exactly
// what the corridor rules are about — beachheads on other people's worlds — and,
// unlike a headcount, everyone can see it coming two rounds out.
//
// Two deliberate restrictions:
//   • Only AUTHORED lanes count (`source` unset). A Jump Gate joins two tiles the
//     builder already holds, so counting engine-added lanes would let a player
//     buy sovereignty from their own treasury; a Launch Pad lane is the same
//     shape on Space Age maps.
//   • The streak advances only at the holder's own turn start, so "three rounds"
//     means three of their turns, and a corridor taken and lost between their
//     turns never scores. `tickLaneSovereignty` is called from
//     `advanceToNextPlayer` beside the seal tick.
//
// The two numbers are ⚠ balance, swept at 200 games (expert, threshold 60,
// seed A) against how often sovereignty ENDS a game — it should be a real
// alternative, not the only ending:
//     5 corridors / 2 rounds → 53.5% of games, avg 26.6 turns  (it takes over)
//     5 corridors / 3 rounds → 38.0%, avg 28.1                 (shipped)
//     6 corridors / 2 rounds → 13.5%, avg 29.9                 (barely fires)
// Six corridors means twelve of the sixteen gateway tiles, which mostly happens
// to players who were already winning on the headcount; the third round is the
// lever that leaves rivals a window to break one corridor and stop it.
//
// Two seats (the Colonies board, state/galaxyModes.ts) needed the rounds again,
// 1,200 games × 3 seeds for the shipped row:
//     5 corridors / 3 rounds → 62.8% of games                  (it takes over)
//     6 corridors / 3 rounds → 10.7%                           (barely fires)
//     5 corridors / 5 rounds → 44.7–45.3%, avg 23.4 turns      (shipped)
// Three seats keep three rounds: 37.6–38.6% of games. Eight seats (the Schism)
// keep them too, seed A of GALAXY-BALANCE.md §8:
//     5 corridors / 2 rounds → 54.2% of games                  (it takes over)
//     5 corridors / 3 rounds → 41.3–44.2% (A–C), avg 40.6 turns (shipped)
//     5 corridors / 4 rounds → 30.8%

import type { GameMap, GameState, MapConnection } from '../../types';
import { getAllowedVictoryConditions } from '../state/gameSettings';

/** Authored lanes whose gateways a player must hold, of the map's total. */
export const LANE_SOVEREIGNTY_CORRIDORS_NEEDED = 5;

/** Consecutive turn starts at or above the corridor bar before the game ends — at three, four and eight seats. */
export const LANE_SOVEREIGNTY_ROUNDS = 3;

/**
 * Rounds a streak must run, by seat count. A streak breaks on a rival's turn
 * between the holder's, so the rounds set how many rival turns it has to
 * survive: (rounds - 1) x (seats - 1). Three rounds is six rival turns at four
 * seats and four at three, but only two at two, where the bar then ended 63% of
 * games; five rounds restores four. At eight it is fourteen, and three rounds
 * still end about 43% of games. ⚠ balance: the two-seat sweep (and why the
 * corridor bar stays at five) is in backend/scripts/GALAXY-BALANCE.md. A seat
 * count not listed uses LANE_SOVEREIGNTY_ROUNDS. The balance sim's
 * SIM_SOVEREIGNTY_ROUNDS patches this object.
 */
export const LANE_SOVEREIGNTY_ROUNDS_BY_SEATS: Record<number, number> = {
  2: 5,
  3: LANE_SOVEREIGNTY_ROUNDS,
  4: LANE_SOVEREIGNTY_ROUNDS,
  8: LANE_SOVEREIGNTY_ROUNDS,
};

/**
 * Rounds a streak must run in this game, by its seat count. Seats, not living
 * players: the rule a game starts with is the one it ends with.
 */
export function roundsNeededFor(state: GameState): number {
  return LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[state.players.length] ?? LANE_SOVEREIGNTY_ROUNDS;
}

/**
 * The lanes sovereignty is played on: authored orbit connections only. Engine-
 * added lanes (`source`) are excluded — see the header.
 */
export function authoredOrbitLanes(map: GameMap): MapConnection[] {
  return map.connections.filter((c) => c.type === 'orbit' && !c.source);
}

/** Authored lanes on which this player holds BOTH gateways. */
export function countCorridors(state: GameState, map: GameMap, playerId: string): number {
  let n = 0;
  for (const c of authoredOrbitLanes(map)) {
    if (
      state.territories[c.from]?.owner_id === playerId
      && state.territories[c.to]?.owner_id === playerId
    ) n += 1;
  }
  return n;
}

/** Corridors needed on this map: the constant, capped by how many lanes exist. */
export function corridorsNeededFor(map: GameMap): number {
  const total = authoredOrbitLanes(map).length;
  return total === 0 ? 0 : Math.min(LANE_SOVEREIGNTY_CORRIDORS_NEEDED, total);
}

/** True when the game is playing for Lane Sovereignty at all. */
export function laneSovereigntyEnabled(state: GameState): boolean {
  return getAllowedVictoryConditions(state.settings).includes('lane_sovereignty');
}

/**
 * Start of `playerId`'s turn: extend their sovereignty streak if they are at or
 * above the corridor bar, otherwise reset it. No-op when the condition is not in
 * play, or on a map with no authored lanes.
 */
export function tickLaneSovereignty(state: GameState, map: GameMap, playerId: string): void {
  if (!laneSovereigntyEnabled(state)) return;
  const need = corridorsNeededFor(map);
  if (need === 0) return;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return;
  const held = countCorridors(state, map, playerId);
  player.lane_sovereignty_streak = held >= need ? (player.lane_sovereignty_streak ?? 0) + 1 : 0;
}

/** True when this player's streak has reached the required rounds. */
export function hasLaneSovereignty(state: GameState, playerId: string): boolean {
  if (!laneSovereigntyEnabled(state)) return false;
  const player = state.players.find((p) => p.player_id === playerId);
  return (player?.lane_sovereignty_streak ?? 0) >= roundsNeededFor(state);
}

export interface LaneSovereigntyProgress {
  /** False when the condition is not in play, or the map has no authored lanes. */
  applicable: boolean;
  held: number;
  needed: number;
  /** Consecutive turn starts already banked at or above the bar. */
  streak: number;
  roundsNeeded: number;
}

/** Progress for the HUD and the AI: how close is this player to the network? */
export function laneSovereigntyProgress(
  state: GameState,
  map: GameMap,
  playerId: string,
): LaneSovereigntyProgress {
  const needed = corridorsNeededFor(map);
  const applicable = laneSovereigntyEnabled(state) && needed > 0;
  const player = state.players.find((p) => p.player_id === playerId);
  return {
    applicable,
    held: applicable ? countCorridors(state, map, playerId) : 0,
    needed,
    streak: player?.lane_sovereignty_streak ?? 0,
    roundsNeeded: roundsNeededFor(state),
  };
}

/**
 * The gateway tiles that would turn an "open" lane into a corridor for this
 * player: they hold one end, a rival (or nobody) holds the other. The AI weighs
 * these when sovereignty is in play and it is within one corridor of the bar.
 */
export function corridorCompletionTargets(
  state: GameState,
  map: GameMap,
  playerId: string,
): Set<string> {
  const out = new Set<string>();
  for (const c of authoredOrbitLanes(map)) {
    const fromMine = state.territories[c.from]?.owner_id === playerId;
    const toMine = state.territories[c.to]?.owner_id === playerId;
    if (fromMine === toMine) continue; // corridor already, or closed to them
    out.add(fromMine ? c.to : c.from);
  }
  return out;
}

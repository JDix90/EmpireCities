// ============================================================
// Transit — distance, made of time
// ============================================================
//
// On a fixed map a fortify is instantaneous because the distance is fictional.
// Between worlds it is not: with transit on, a fortify whose two ends sit on
// DIFFERENT worlds stops being a teleport and becomes a convoy. The units leave
// their garrison at once — the world they left is weaker the moment the order is
// given — and arrive at the start of the mover's next turn.
//
// Three consequences, which are the whole point of the mechanic:
//   • it is a commitment: the units defend nothing while they are in the void;
//   • it is legible: the convoy sits in shared state, so both worlds can see the
//     reinforcement coming and act before it lands;
//   • it can fail: if the destination is not the mover's any more when the
//     convoy arrives, it turns back to where it came from, and if that is gone
//     too the convoy is lost with the war it was sent to fight.
//
// Drift Jump is exempt. The Helion signature is a jump between two beacons the
// pilot already knows, not a haul — making it a convoy would delete the faction's
// reason to exist. It lands the same turn, as it always has.
//
// Gated by `settings.galaxy_transit_enabled`, which ships OFF: this was always
// the phase the plan wanted prototyped and measured before it was believed.

import type { GameMap, GameState } from '../../types';

/** Rounds a convoy spends in the void. One: it lands at the mover's next turn. */
export const TRANSIT_DELAY_ROUNDS = 1;

export interface TransitConvoy {
  id: string;
  owner_id: string;
  from: string;
  to: string;
  units: number;
  /** Rounds still to wait. Ticked at the owner's own turn start. */
  turns_remaining: number;
}

export type TransitOutcome = 'landed' | 'turned_back' | 'lost';

export interface TransitArrival {
  convoy: TransitConvoy;
  outcome: TransitOutcome;
}

export function transitEnabled(state: GameState): boolean {
  return state.settings?.galaxy_transit_enabled === true;
}

/**
 * Does this fortify become a convoy? Only when transit is on and the two ends
 * sit on different worlds — which, on a galaxy map, is exactly the set of
 * fortifies whose route must cross a hyperspace lane. A Drift Jump never does.
 */
export function fortifyBecomesConvoy(
  state: GameState,
  fromId: string,
  toId: string,
  opts?: { driftJump?: boolean },
): boolean {
  if (!transitEnabled(state) || opts?.driftJump) return false;
  const from = state.territories[fromId];
  const to = state.territories[toId];
  if (!from || !to || !from.world_id || !to.world_id) return false;
  return from.world_id !== to.world_id;
}

/**
 * Send the units. They leave the source immediately; the convoy is recorded on
 * shared state until it lands. Caller has already validated the move.
 */
export function launchConvoy(
  state: GameState,
  playerId: string,
  fromId: string,
  toId: string,
  units: number,
): TransitConvoy {
  const from = state.territories[fromId];
  from.unit_count -= units;
  const convoy: TransitConvoy = {
    // Deterministic enough to be stable across a persist/reload, unique enough
    // that two convoys on the same edge in one turn do not collide.
    id: `${playerId}:${fromId}:${toId}:${state.turn_number}:${(state.transits ?? []).length}`,
    owner_id: playerId,
    from: fromId,
    to: toId,
    units,
    turns_remaining: TRANSIT_DELAY_ROUNDS,
  };
  state.transits = [...(state.transits ?? []), convoy];
  return convoy;
}

/**
 * The start of `playerId`'s turn: age their convoys and land the ones that are
 * due. A convoy lands on its destination if that is still theirs; otherwise it
 * turns back to its origin if THAT is still theirs; otherwise it is lost.
 * Returns what happened, so the socket can narrate it.
 */
export function arriveConvoys(state: GameState, playerId: string): TransitArrival[] {
  const all = state.transits;
  if (!all || all.length === 0) return [];
  const arrivals: TransitArrival[] = [];
  const remaining: TransitConvoy[] = [];
  for (const convoy of all) {
    if (convoy.owner_id !== playerId) {
      remaining.push(convoy);
      continue;
    }
    const left = convoy.turns_remaining - 1;
    if (left > 0) {
      remaining.push({ ...convoy, turns_remaining: left });
      continue;
    }
    const dest = state.territories[convoy.to];
    const origin = state.territories[convoy.from];
    if (dest?.owner_id === playerId) {
      dest.unit_count += convoy.units;
      arrivals.push({ convoy, outcome: 'landed' });
    } else if (origin?.owner_id === playerId) {
      origin.unit_count += convoy.units;
      arrivals.push({ convoy, outcome: 'turned_back' });
    } else {
      arrivals.push({ convoy, outcome: 'lost' });
    }
  }
  state.transits = remaining.length > 0 ? remaining : undefined;
  return arrivals;
}

/** Convoys currently in the void, oldest first. */
export function convoysInTransit(state: GameState, playerId?: string): TransitConvoy[] {
  const all = state.transits ?? [];
  return playerId ? all.filter((c) => c.owner_id === playerId) : all;
}

/** Units this player has committed to convoys — absent from every garrison. */
export function unitsInTransit(state: GameState, playerId: string): number {
  return convoysInTransit(state, playerId).reduce((n, c) => n + c.units, 0);
}

/**
 * A convoy's endpoints must both exist on the map for the UI to draw it. Used by
 * the room-load repair to drop convoys stranded by a map change.
 */
export function pruneStrandedConvoys(map: GameMap, state: GameState): boolean {
  const all = state.transits;
  if (!all || all.length === 0) return false;
  const known = new Set(map.territories.map((t) => t.territory_id));
  const live = all.filter((c) => known.has(c.from) && known.has(c.to));
  if (live.length === all.length) return false;
  state.transits = live.length > 0 ? live : undefined;
  return true;
}

/**
 * AI parity for the Galactic Age lane powers (abilities/lanePowers.ts,
 * docs/GALACTIC_AGE_BUILDINGS.md §6).
 *
 * A power a bot never fires is a power three quarters of the table never sees,
 * and the phase's gate is measured in usage, as the Moon package's was. These
 * functions CHOOSE; `executeTechAbility` re-validates every use, so nothing here
 * permits anything.
 *
 *   Orbital Muster  on the industry gateway facing the most enemy units — across
 *                   its lane first, then by land;
 *   Lance Battery   before a planned crossing, when the far gateway holds more
 *                   than the lane's two dice can reasonably beat;
 *   Seal Breaker    only when a seal or closure actually shuts a lane the bot
 *                   could win across, and then the caller plans that crossing;
 *   Surge Projector only into a weakly held rival gateway across a ring gap,
 *                   and then the caller plans that crossing first.
 *
 * Easy and tutorial bots never fire them. `aiLanePowerReserve` is the PP the bot
 * keeps back for the dearest power it holds, so the garrison purchases made
 * earlier in the draft cannot spend the fuel the powers need.
 */

import type { AiDifficulty, GameMap, GameState } from '../../types';
import type { AiAction } from './aiBot';
import { playerHasUnlockedAbility } from '../abilities/techAbilities';
import {
  LANE_POWER_IDS,
  crossableLanes,
  isLaneGateway,
  lanePowerCost,
  lanePowerSources,
  lanePowersEnabled,
  surgeProjectorSources,
} from '../abilities/lanePowers';
import { ringGapLanes } from '../state/galaxyRing';
import { isLaneSealedForPlayer } from '../state/moonAccess';
import { isFriendlyOwner } from '../state/teams';

/**
 * A far gateway holding at least this many units is worth the battery: two
 * lane dice against two defence dice lose more than they win, and taking two
 * units off first is what makes the crossing a fight.
 */
export const AI_LANCE_MIN_TARGET_UNITS = 3;

/**
 * A Surge Projector is 10 PP for one crossing, so the bot opens a gap only
 * where its stack outnumbers the far gateway by at least this much after
 * leaving one behind: "weakly held", in the doc's words.
 */
export const AI_SURGE_MIN_EDGE = 2;

/** Easy and tutorial bots stay off the powers. */
export function aiFiresLanePowers(difficulty: AiDifficulty): boolean {
  return difficulty !== 'easy' && difficulty !== 'tutorial';
}

/** Unlocked, unused this turn, and affordable right now. */
export function canAiFireLanePower(state: GameState, playerId: string, abilityId: string): boolean {
  if (!lanePowersEnabled(state)) return false;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return false;
  if ((player.ability_uses ?? {})[abilityId]) return false;
  if (!playerHasUnlockedAbility(state, playerId, abilityId)) return false;
  return (player.special_resource ?? 0) >= lanePowerCost(abilityId);
}

/** PP to keep back: the dearest lane power the bot holds and has not fired this turn. */
export function aiLanePowerReserve(state: GameState, playerId: string): number {
  if (!lanePowersEnabled(state)) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  let reserve = 0;
  for (const id of LANE_POWER_IDS) {
    if ((player.ability_uses ?? {})[id]) continue;
    if (!playerHasUnlockedAbility(state, playerId, id)) continue;
    reserve = Math.max(reserve, lanePowerCost(id));
  }
  return reserve;
}

const isRival = (state: GameState, playerId: string, ownerId: string | null | undefined): boolean =>
  !!ownerId && !isFriendlyOwner(state, playerId, ownerId);

/** Orbital Muster: the industry gateway facing the most enemy units. */
export function selectAiOrbitalMusterTarget(state: GameState, map: GameMap, playerId: string): string | null {
  const lanes = crossableLanes(map);
  let best: { tid: string; threat: number; lane: boolean } | null = null;
  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.owner_id !== playerId) continue;
    if (lanePowerSources(state, map, playerId, 'orbital_muster', tid).length === 0) continue;
    let laneThreat = 0;
    for (const c of lanes) {
      const far = c.from === tid ? c.to : c.to === tid ? c.from : null;
      if (far && isRival(state, playerId, state.territories[far]?.owner_id)) {
        laneThreat += state.territories[far]?.unit_count ?? 0;
      }
    }
    let landThreat = 0;
    for (const c of map.connections ?? []) {
      if (c.type === 'orbit') continue;
      const far = c.from === tid ? c.to : c.to === tid ? c.from : null;
      if (far && isRival(state, playerId, state.territories[far]?.owner_id)) {
        landThreat += state.territories[far]?.unit_count ?? 0;
      }
    }
    // A gateway's lane threat outranks any inland border: the lanes are where
    // the era is fought, and the muster is meant to hold one.
    const lane = laneThreat > 0;
    const threat = lane ? laneThreat : landThreat;
    if (threat <= 0) continue;
    if (
      !best
      || (lane && !best.lane)
      || (lane === best.lane && (threat > best.threat || (threat === best.threat && tid < best.tid)))
    ) {
      best = { tid, threat, lane };
    }
  }
  return best?.tid ?? null;
}

/** Lance Battery: the far gateway of a planned crossing that is too stout to cross into. */
export function selectAiLanceBatteryTarget(
  state: GameState,
  map: GameMap,
  playerId: string,
  planned: AiAction[],
): string | null {
  const laneKeys = new Set(crossableLanes(map).map((c) => (c.from < c.to ? `${c.from}::${c.to}` : `${c.to}::${c.from}`)));
  let best: { tid: string; units: number } | null = null;
  for (const a of planned) {
    if (a.type !== 'attack' || !a.from || !a.to) continue;
    const key = a.from < a.to ? `${a.from}::${a.to}` : `${a.to}::${a.from}`;
    if (!laneKeys.has(key)) continue;
    const target = state.territories[a.to];
    if (!target || !isRival(state, playerId, target.owner_id)) continue;
    if (target.unit_count < AI_LANCE_MIN_TARGET_UNITS) continue;
    if (lanePowerSources(state, map, playerId, 'lance_battery', a.to).length === 0) continue;
    if (!best || target.unit_count > best.units) best = { tid: a.to, units: target.unit_count };
  }
  return best?.tid ?? null;
}

/**
 * Seal Breaker: a gateway the bot holds, with a defence building, whose lane is
 * shut to it and lands on a rival it can beat. The caller fires the power on
 * `source` and plans the crossing to `target`.
 */
export function selectAiSealBreaker(
  state: GameState,
  map: GameMap,
  playerId: string,
): { source: string; target: string } | null {
  let best: { source: string; target: string; edge: number } | null = null;
  for (const c of crossableLanes(map)) {
    for (const [near, far] of [[c.from, c.to], [c.to, c.from]] as const) {
      const n = state.territories[near];
      const f = state.territories[far];
      if (!n || !f || n.owner_id !== playerId || !isRival(state, playerId, f.owner_id)) continue;
      if (!isLaneSealedForPlayer(state, near, far, playerId)) continue;
      if (!isLaneGateway(map, near)) continue;
      if (lanePowerSources(state, map, playerId, 'seal_breaker', near).length === 0) continue;
      // Worth breaking only into a crossing the stack should win.
      const edge = n.unit_count - 1 - f.unit_count;
      if (n.unit_count < 3 || edge < 1) continue;
      if (!best || edge > best.edge) best = { source: near, target: far, edge };
    }
  }
  return best ? { source: best.source, target: best.target } : null;
}

/**
 * Surge Projector: a gap in the ring whose near gateway the bot holds, with a
 * Jump Gate on each of the gap's worlds, and whose far gateway a rival holds
 * weakly. The caller fires the power on `target` and plans the crossing from
 * `source` first.
 */
export function selectAiSurgeProjector(
  state: GameState,
  map: GameMap,
  playerId: string,
): { source: string; target: string } | null {
  let best: { source: string; target: string; edge: number } | null = null;
  for (const gap of ringGapLanes(map)) {
    for (const [near, far] of [[gap.from, gap.to], [gap.to, gap.from]] as const) {
      const n = state.territories[near];
      const f = state.territories[far];
      if (!n || !f || n.owner_id !== playerId || !isRival(state, playerId, f.owner_id)) continue;
      if (!surgeProjectorSources(state, map, playerId, far).includes(near)) continue;
      const edge = n.unit_count - 1 - f.unit_count;
      if (n.unit_count < 3 || edge < AI_SURGE_MIN_EDGE) continue;
      if (!best || edge > best.edge || (edge === best.edge && far < best.target)) best = { source: near, target: far, edge };
    }
  }
  return best ? { source: best.source, target: best.target } : null;
}

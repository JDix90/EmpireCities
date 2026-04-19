// ============================================================
// Space Age Moon Access — gating logic for orbit connections
// ============================================================
//
// A player may traverse an `orbit` connection (and therefore reach
// Moon territories) only when ALL three prerequisites are satisfied:
//
//   1. Tech         — `sa_lunar_expansion` is in their unlocked_techs
//   2. Building     — they own a territory with the `launch_pad` building
//   3. Ability      — they have used the `launch_space_station` ability
//                      (sets `space_station_launched` on the player)
//
// Exceptions:
//   • `lunar_pioneers` faction starts with Moon access (space_station_launched = true).
//   • Owners of the `wonder_space_elevator` wonder may skip step 3.

import type { GameState, PlayerState, GameMap } from '../../types';

export interface MoonAccessState {
  hasTech: boolean;
  hasLaunchPad: boolean;
  hasLaunchedStation: boolean;
  hasSpaceElevator: boolean;
  isLunarPioneer: boolean;
  /** Overall access (true when gating passes). */
  allowed: boolean;
  /** Human-readable list of missing requirements (for error messages). */
  missing: string[];
}

/** Compute full access breakdown for a player. Useful for both server gating and UI. */
export function getMoonAccessState(state: GameState, player: PlayerState): MoonAccessState {
  const isLunarPioneer = player.faction_id === 'lunar_pioneers';
  const hasTech = player.unlocked_techs?.includes('sa_lunar_expansion') ?? false;
  const hasLaunchPad = Object.values(state.territories).some(
    (t) => t.owner_id === player.player_id && (t.buildings?.includes('launch_pad') ?? false),
  );
  const hasSpaceElevator = Object.values(state.territories).some(
    (t) => t.owner_id === player.player_id && (t.buildings?.includes('wonder_space_elevator') ?? false),
  );
  const hasLaunchedStation = player.space_station_launched === true;

  let allowed = false;
  const missing: string[] = [];

  if (isLunarPioneer) {
    allowed = true;
  } else {
    if (!hasTech) missing.push('Lunar Expansion tech');
    if (!hasLaunchPad) missing.push('Launch Pad building');
    if (!hasLaunchedStation && !hasSpaceElevator) missing.push('launched Space Station');
    allowed = missing.length === 0;
  }

  return { hasTech, hasLaunchPad, hasLaunchedStation, hasSpaceElevator, isLunarPioneer, allowed, missing };
}

/** True when the player currently meets all Moon-access requirements. */
export function playerHasMoonAccess(state: GameState, player: PlayerState): boolean {
  return getMoonAccessState(state, player).allowed;
}

/** True when traversing (attacking/fortifying/claiming through) this connection needs Moon access. */
export function connectionRequiresMoonAccess(
  map: GameMap,
  fromId: string,
  toId: string,
): boolean {
  const conn = map.connections.find(
    (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId),
  );
  return conn?.type === 'orbit';
}

/** True when the territory itself is on the Moon (claiming also requires access). */
export function territoryIsLunar(map: GameMap, territoryId: string): boolean {
  const t = map.territories.find((tt) => tt.territory_id === territoryId);
  return t?.globe_id === 'moon';
}

/** Format a missing-requirements message for the player. */
export function formatMoonAccessError(access: MoonAccessState): string {
  if (access.allowed) return '';
  return `Moon access requires: ${access.missing.join(' + ')}`;
}

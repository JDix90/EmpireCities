// ============================================================
// Orbit access — Space Age Moon ladder + Galactic hyperspace tech
// ============================================================

import { inferWorldId } from '@borderfall/shared';
import type { GameState, PlayerState, GameMap, EraId, OrbitAccessMode } from '../../types';

export interface MoonAccessState {
  hasTech: boolean;
  hasLaunchPad: boolean;
  hasLaunchedStation: boolean;
  hasSpaceElevator: boolean;
  isLunarPioneer: boolean;
  allowed: boolean;
  missing: string[];
}

export interface OrbitAccessResult {
  allowed: boolean;
  missing: string[];
}

export function resolveOrbitAccessMode(map: GameMap, era: EraId): OrbitAccessMode {
  if (map.orbit_access) return map.orbit_access;
  if (era === 'galaxy_age') return 'galaxy_hyperspace';
  if (era === 'space_age') return 'space_age_moon';
  return 'none';
}

/** Compute Space Age Moon access (legacy breakdown). */
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

export function playerHasMoonAccess(state: GameState, player: PlayerState): boolean {
  return getMoonAccessState(state, player).allowed;
}

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

/**
 * True when claiming this territory should require orbit / hyperspace access
 * (Moon, or worlds flagged `requires_orbit_access` on galaxy maps).
 */
export function territoryRequiresOrbitAccessForClaim(map: GameMap, territoryId: string): boolean {
  const t = map.territories.find((tt) => tt.territory_id === territoryId);
  if (!t) return false;
  const wid = inferWorldId(t);
  const def = map.worlds?.find((w) => w.world_id === wid);
  if (def && typeof def.requires_orbit_access === 'boolean') return def.requires_orbit_access;
  return wid === 'moon';
}

/**
 * Territories on worlds that begin neutral with a small garrison instead of being
 * distributed to players. Two cases qualify:
 *   1. The world's manifest sets `initial_neutral_garrison: true` (galaxy maps that
 *      want a contested neutral world even though factions could otherwise spawn).
 *   2. Legacy fallback: world is the Moon and no manifest entry overrides it
 *      (preserves Space Age behavior where Lunar Pioneers and everyone else must
 *      conquer the moon after teching up).
 *
 * NOTE: Galaxy era worlds with `requires_orbit_access: true` are NOT automatically
 * neutral — that gate only blocks claims/attacks across orbit edges, not initial
 * spawning. Faction homes on locked worlds are intentional: hyperspace tech then
 * unlocks contact between rival factions.
 */
export function offworldTerritoryIdsForInitialNeutral(map: GameMap): Set<string> {
  const neutralWorldIds = new Set<string>();
  const knownWorldIds = new Set<string>();
  for (const w of map.worlds ?? []) {
    knownWorldIds.add(w.world_id);
    if (w.initial_neutral_garrison === true) neutralWorldIds.add(w.world_id);
  }
  return new Set(
    map.territories
      .filter((t) => {
        const wid = inferWorldId(t);
        if (neutralWorldIds.has(wid)) return true;
        if (!knownWorldIds.has(wid) && wid === 'moon') return true;
        return false;
      })
      .map((t) => t.territory_id),
  );
}

/**
 * Fortify / access checks: Space Age still treats any Moon endpoint as gated;
 * galaxy maps only gate explicit orbit edges (interior offworld moves are free).
 */
export function fortifyEndpointsRequireOrbitAccess(
  map: GameMap,
  era: EraId,
  fromId: string,
  toId: string,
): boolean {
  if (connectionRequiresMoonAccess(map, fromId, toId)) return true;
  if (era !== 'space_age') return false;
  const fromT = map.territories.find((t) => t.territory_id === fromId);
  const toT = map.territories.find((t) => t.territory_id === toId);
  if (!fromT || !toT) return false;
  return inferWorldId(fromT) === 'moon' || inferWorldId(toT) === 'moon';
}

/** Unified orbit gate for claims + fortify + orbit attacks. */
export function getOrbitAccessResult(
  state: GameState,
  player: PlayerState,
  map: GameMap,
  era: EraId,
): OrbitAccessResult {
  const mode = resolveOrbitAccessMode(map, era);
  if (mode === 'none') return { allowed: true, missing: [] };

  if (mode === 'space_age_moon') {
    const m = getMoonAccessState(state, player);
    return { allowed: m.allowed, missing: m.missing };
  }

  // galaxy_hyperspace
  if (player.faction_id === 'helion_navigators') {
    return { allowed: true, missing: [] };
  }
  const hasAnchor = Object.values(state.territories ?? {}).some(
    (t) =>
      t.owner_id === player.player_id &&
      (t.buildings?.includes('wonder_hyperlane_anchor') ?? false),
  );
  if (hasAnchor) return { allowed: true, missing: [] };
  const hasTech = player.unlocked_techs?.includes('ga_hyperspace_chart') ?? false;
  if (hasTech) return { allowed: true, missing: [] };
  return { allowed: false, missing: ['Hyperspace Chart tech'] };
}

export function formatOrbitAccessError(access: OrbitAccessResult): string {
  if (access.allowed) return '';
  if (access.missing.length === 0) return 'Orbit access denied';
  return `Hyperspace travel requires: ${access.missing.join(' + ')}`;
}

export function formatMoonAccessError(access: MoonAccessState): string {
  if (access.allowed) return '';
  return `Moon access requires: ${access.missing.join(' + ')}`;
}

/** @deprecated Use territoryRequiresOrbitAccessForClaim + inferWorldId === 'moon' at call sites. */
export function territoryIsLunar(map: GameMap, territoryId: string): boolean {
  const t = map.territories.find((tt) => tt.territory_id === territoryId);
  return inferWorldId(t ?? { territory_id: '', region_id: '' }) === 'moon';
}

// ============================================================
// Contestable hyperspace lanes (galaxy) — active lane seals
// ============================================================

/** Rounds a fresh lane seal lasts. */
export const GALAXY_LANE_SEAL_DURATION = 3;

/** Canonical, order-independent id for the orbit lane between two territories. */
export function orbitLaneId(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** True if (a,b) is an orbit-type connection on this map. */
export function isOrbitLane(map: GameMap, a: string, b: string): boolean {
  return map.connections.some(
    (c) => c.type === 'orbit' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)),
  );
}

/**
 * True when an active lane seal owned by ANOTHER player blocks `playerId` from
 * crossing the orbit edge from→to. The sealer can still use their own lane.
 */
export function isLaneSealedForPlayer(state: GameState, fromId: string, toId: string, playerId: string): boolean {
  if (!state.settings.lanes_contestable_enabled) return false;
  const bl = state.lane_blockades?.[orbitLaneId(fromId, toId)];
  if (!bl || bl.turns_remaining <= 0) return false;
  return bl.owner_id !== playerId;
}

export interface SealLaneCheck { ok: boolean; error?: string; laneId?: string }

/** Validate whether `playerId` may seal the orbit lane (from,to) right now. */
export function canSealLane(
  state: GameState,
  map: GameMap,
  fromId: string,
  toId: string,
  playerId: string,
): SealLaneCheck {
  if (!state.settings.lanes_contestable_enabled) return { ok: false, error: 'Lane seals are not enabled' };
  if (!isOrbitLane(map, fromId, toId)) return { ok: false, error: 'Not a hyperspace lane' };
  const ownsEndpoint =
    state.territories[fromId]?.owner_id === playerId || state.territories[toId]?.owner_id === playerId;
  if (!ownsEndpoint) return { ok: false, error: 'You must hold one end of the lane to seal it' };
  const id = orbitLaneId(fromId, toId);
  const blockades = state.lane_blockades ?? {};
  const existing = blockades[id];
  if (existing && existing.turns_remaining > 0 && existing.owner_id !== playerId) {
    return { ok: false, error: 'This lane is already sealed by a rival' };
  }
  // One active seal per player (refreshing your own lane is allowed).
  const otherActive = Object.entries(blockades).some(
    ([lid, b]) => lid !== id && b.owner_id === playerId && b.turns_remaining > 0,
  );
  if (otherActive) return { ok: false, error: 'You already have a lane sealed — wait for it to lift' };
  return { ok: true, laneId: id };
}

/** Decrement all active lane seals by one round; drop expired. Call once per round. */
export function tickLaneBlockades(state: GameState): void {
  if (!state.lane_blockades) return;
  for (const [id, b] of Object.entries(state.lane_blockades)) {
    b.turns_remaining -= 1;
    if (b.turns_remaining <= 0) delete state.lane_blockades[id];
  }
}

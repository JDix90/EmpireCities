// ============================================================
// Orbit access — Space Age Moon ladder + Galactic hyperspace tech
// ============================================================

import { inferWorldId } from '@borderfall/shared';
import type { GameState, PlayerState, GameMap, EraId, OrbitAccessMode, MapConnection } from '../../types';
import { contestAccessMissing, contestOpensMoonAccess } from './lunarHegemony';

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
  /** Which gate produced this result — drives player-facing denial copy. */
  mode: OrbitAccessMode;
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
 * Territory ids that are exempt from the territory-selection draft: orbit-gated
 * tiles can never be claimed during selection (no player can hold orbit access
 * at game start), and seeded neutral frontiers (`unlock_era_index > 0`) are
 * conquered, not drafted. Counting either would soft-lock the selection phase,
 * which only completes when every OTHER territory is claimed.
 */
export function selectionExemptTerritoryIds(map: GameMap): Set<string> {
  return new Set(
    map.territories
      .filter(
        (t) =>
          territoryRequiresOrbitAccessForClaim(map, t.territory_id) ||
          (t.unlock_era_index ?? 0) > 0,
      )
      .map((t) => t.territory_id),
  );
}

/**
 * Fortify gating matches attack gating: crossing between worlds needs access,
 * on every map and era. Space Age used to gate any move with a Moon endpoint,
 * which froze troop movement BETWEEN a player's own Moon tiles the moment they
 * lost their last Launch Pad — while attacking and reinforcing those same tiles
 * stayed legal, so the rule read as a bug rather than a cost. Interior movement
 * on one world is therefore free.
 *
 * The endpoints are gated on TWO grounds, not one. An orbit edge is the obvious
 * case. But fortify validates reachability with a BFS over the player's own
 * territories, and a multi-hop path may route through an orbit lane while
 * NEITHER endpoint sits on one: measured, a player holding
 * na_eastern_corridor → na_launch_base → moon_near_side_north → moon_mare_imbrium
 * with no Launch Pad at all moved 5 units from Earth to the Moon, because the
 * edge-only test saw a plain land-to-land pair and waved it through. Comparing
 * worlds closes that, and is the only check the AI path has — AI fortify moves
 * are not path-validated at all, so an arbitrary owned pair reaches here.
 *
 * This is a backstop, not the whole rule: it cannot see a Moon→Moon fortify
 * that routes through Earth across two lanes. `fortifyTraversalFilter` handles
 * the path itself.
 */
export function fortifyEndpointsRequireOrbitAccess(
  map: GameMap,
  _era: EraId,
  fromId: string,
  toId: string,
): boolean {
  if (connectionRequiresMoonAccess(map, fromId, toId)) return true;
  const from = map.territories.find((t) => t.territory_id === fromId);
  const to = map.territories.find((t) => t.territory_id === toId);
  if (!from || !to) return false;
  return inferWorldId(from) !== inferWorldId(to);
}

/**
 * Edge predicate for the fortify reachability BFS: may this player move troops
 * across this connection right now?
 *
 * Only orbit lanes are ever refused, and for the same two reasons crossing one
 * directly is refused — no orbit access, or the lane is sealed against them.
 * Everything else is freely traversable, so interior movement on either world
 * is untouched.
 *
 * Access is resolved once, here, rather than per edge inside the BFS.
 */
export function fortifyTraversalFilter(
  state: GameState,
  player: PlayerState,
  map: GameMap,
  era: EraId,
): (conn: MapConnection) => boolean {
  const access = getOrbitAccessResult(state, player, map, era);
  return (conn) => {
    if (conn.type !== 'orbit') return true;
    if (!access.allowed) return false;
    return !isLaneSealedForPlayer(state, conn.from, conn.to, player.player_id);
  };
}

/** Unified orbit gate for claims + fortify + orbit attacks. */
export function getOrbitAccessResult(
  state: GameState,
  player: PlayerState,
  map: GameMap,
  era: EraId,
): OrbitAccessResult {
  const mode = resolveOrbitAccessMode(map, era);
  if (mode === 'none') return { allowed: true, missing: [], mode };

  if (mode === 'space_age_moon') {
    const m = getMoonAccessState(state, player);
    if (m.allowed) return { allowed: true, missing: [], mode };
    // The contest rule (Moon Race, Phase 3): once ANOTHER player holds lunar
    // ground, the cost of joining the fight drops to Launch Pad tech plus a
    // Launch Pad — two techs and one build, against the four techs and two
    // builds the first lander paid. Without it the cost to contest an occupied
    // Moon equals the cost to discover it, and a Moon-based victory becomes
    // first-to-Moon-wins. See state/lunarHegemony.ts.
    if (contestOpensMoonAccess(state, player.player_id)) {
      const missing = contestAccessMissing(state, player);
      return { allowed: missing.length === 0, missing, mode };
    }
    return { allowed: m.allowed, missing: m.missing, mode };
  }

  // galaxy_hyperspace
  if (player.faction_id === 'helion_navigators') {
    return { allowed: true, missing: [], mode };
  }
  const hasAnchor = Object.values(state.territories ?? {}).some(
    (t) =>
      t.owner_id === player.player_id &&
      (t.buildings?.includes('wonder_hyperlane_anchor') ?? false),
  );
  if (hasAnchor) return { allowed: true, missing: [], mode };
  const hasTech = player.unlocked_techs?.includes('ga_hyperspace_chart') ?? false;
  if (hasTech) return { allowed: true, missing: [], mode };
  return { allowed: false, missing: ['Hyperspace Chart tech'], mode };
}

// ============================================================
// Launch Pad lanes — a pad opens an orbit lane to the nearest landing zone
// ============================================================

/**
 * The authored Space Age map has exactly three orbit lanes, so a player who
 * finished the whole Space Program without holding Cape Canaveral, Kourou or
 * Gobi had no edge to cross (measured: 0 Moon captures for such players across
 * 480 simulated seats). A Launch Pad now opens its own lane from the pad's
 * territory to the nearest authored landing zone, so the building is the
 * route and the authored spaceports are free shortcuts rather than a hard
 * geographic requirement. Access across the lane is still decided by
 * getOrbitAccessResult; the lane only exists.
 */
export const LAUNCH_PAD_LANE_SOURCE = 'launch_pad' as const;

export interface LandingZone {
  /** Earth endpoint of the authored orbit lane the pad is closest to. */
  earthAnchor: string;
  /** Moon endpoint of that lane — where the pad's lane lands. */
  moonTarget: string;
}

function isAuthoredOrbitLane(c: MapConnection): boolean {
  return c.type === 'orbit' && c.source !== LAUNCH_PAD_LANE_SOURCE;
}

/**
 * Authored orbit lanes as (Earth anchor, Moon target) pairs, in authored order
 * so hop-distance ties resolve deterministically.
 */
function authoredLandingZones(map: GameMap): LandingZone[] {
  const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
  const zones: LandingZone[] = [];
  for (const c of map.connections) {
    if (!isAuthoredOrbitLane(c)) continue;
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    const fromWorld = inferWorldId(from);
    const toWorld = inferWorldId(to);
    if (fromWorld === 'earth' && toWorld !== 'earth') zones.push({ earthAnchor: c.from, moonTarget: c.to });
    else if (toWorld === 'earth' && fromWorld !== 'earth') zones.push({ earthAnchor: c.to, moonTarget: c.from });
  }
  return zones;
}

/**
 * The landing zone a Launch Pad on `territoryId` would open a lane to: the
 * authored anchor with the fewest hops from the pad over the map's current
 * connections (any type). Null when the territory is off Earth, unknown, or
 * the map has no authored orbit lane (nothing to be "nearest" to).
 */
export function nearestLandingZoneFor(map: GameMap, territoryId: string): LandingZone | null {
  const origin = map.territories.find((t) => t.territory_id === territoryId);
  if (!origin || inferWorldId(origin) !== 'earth') return null;
  const zones = authoredLandingZones(map);
  if (zones.length === 0) return null;

  const adj = new Map<string, string[]>();
  for (const c of map.connections) {
    (adj.get(c.from) ?? adj.set(c.from, []).get(c.from)!).push(c.to);
    (adj.get(c.to) ?? adj.set(c.to, []).get(c.to)!).push(c.from);
  }
  const visited = new Set<string>([territoryId]);
  let frontier = [territoryId];
  while (frontier.length > 0) {
    // Scan a whole BFS layer before choosing, so equal-distance anchors tie
    // break on authored order rather than on traversal order.
    const hit = zones.find((z) => frontier.includes(z.earthAnchor));
    if (hit) return hit;
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (visited.has(n)) continue;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Territories on Earth whose buildings include a Launch Pad. */
function launchPadTerritoryIds(map: GameMap, state: GameState): string[] {
  const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
  return Object.values(state.territories)
    .filter((t) => t.buildings?.includes('launch_pad') ?? false)
    .map((t) => t.territory_id)
    .filter((id) => {
      const t = byId.get(id);
      return !!t && inferWorldId(t) === 'earth';
    })
    .sort();
}

/**
 * The orbit lanes every current Launch Pad should have. A pad next to an
 * authored anchor that is already connected to the same Moon tile adds nothing.
 */
export function launchPadLaneConnections(map: GameMap, state: GameState): MapConnection[] {
  const lanes: MapConnection[] = [];
  for (const padId of launchPadTerritoryIds(map, state)) {
    const zone = nearestLandingZoneFor(map, padId);
    if (!zone) continue;
    const alreadyLinked = map.connections.some(
      (c) => c.source !== LAUNCH_PAD_LANE_SOURCE
        && ((c.from === padId && c.to === zone.moonTarget) || (c.from === zone.moonTarget && c.to === padId)),
    );
    if (alreadyLinked) continue;
    lanes.push({ from: padId, to: zone.moonTarget, type: 'orbit', source: LAUNCH_PAD_LANE_SOURCE });
  }
  return lanes;
}

/**
 * Bring the game's map copy in line with its Launch Pads: add lanes for new
 * pads, drop lanes whose pad is gone (an atom bomb clears buildings). Runs on
 * room load as well as after each build, so a room rehydrated from the
 * authored map regains its lanes. Returns true when the map changed.
 */
export function syncLaunchPadLanes(map: GameMap, state: GameState): boolean {
  const wanted = launchPadLaneConnections(map, state);
  const wantedKeys = new Set(wanted.map((c) => orbitLaneId(c.from, c.to)));
  const existing = map.connections.filter((c) => c.source === LAUNCH_PAD_LANE_SOURCE);
  const existingKeys = new Set(existing.map((c) => orbitLaneId(c.from, c.to)));
  const stale = existing.filter((c) => !wantedKeys.has(orbitLaneId(c.from, c.to)));
  const missing = wanted.filter((c) => !existingKeys.has(orbitLaneId(c.from, c.to)));
  if (stale.length === 0 && missing.length === 0) return false;
  const staleKeys = new Set(stale.map((c) => orbitLaneId(c.from, c.to)));
  // Replace the array rather than mutating it: consumers cache adjacency keyed
  // on `map.connections` identity, so an in-place push leaves them reading a
  // graph without the new lane (the AI planner did exactly that).
  map.connections = [
    ...map.connections.filter(
      (c) => c.source !== LAUNCH_PAD_LANE_SOURCE || !staleKeys.has(orbitLaneId(c.from, c.to)),
    ),
    ...missing,
  ];
  return true;
}

/**
 * Player-facing denial copy, worded for the gate that fired: the Space Age
 * Moon ladder says "Moon access requires: …" (matching the client-side hint in
 * frontend/src/utils/orbitAccess.ts), while Galactic hyperspace keeps
 * "Hyperspace travel requires: …". Previously every mode used the hyperspace
 * wording, so Space Age players were told about hyperspace on a Moon attack.
 */
export function formatOrbitAccessError(access: OrbitAccessResult): string {
  if (access.allowed) return '';
  if (access.missing.length === 0) return 'Orbit access denied';
  if (access.mode === 'space_age_moon') {
    return `Moon access requires: ${access.missing.join(' + ')}`;
  }
  return `Hyperspace travel requires: ${access.missing.join(' + ')}`;
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

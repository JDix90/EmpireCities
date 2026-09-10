// ============================================================
// Orbit access — Space Age Moon ladder + Galactic hyperspace tech
// ============================================================

import { inferWorldId } from '@borderfall/shared';
import { resolvePlayerEraId } from '../eraAdvancement/constants';
import { isLaneClosedByWeather } from './laneWeather';
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

/**
 * How far along the orbit ladder a mode sits. Only an ordering, not a judgement
 * about strictness — `galaxy_hyperspace` under corridors is the more PERMISSIVE
 * of the two, which is the point: a player who reached the Galactic Age has the
 * drives, and crossing a lane is about holding a gateway rather than owning a
 * Space Program they can no longer research.
 */
const ORBIT_MODE_RANK: Record<OrbitAccessMode, number> = {
  none: 0,
  space_age_moon: 1,
  galaxy_hyperspace: 2,
};

/**
 * The orbit regime governing ONE player: the later of the board's era and their
 * own. Both halves are needed and neither alone is right.
 *
 *  • The board's era alone is wrong on an era-advancement board that does not
 *    transform — Space to Stars stays `space_age` all game, so a player who
 *    climbed to the Galactic Age would still be held to the Space Age ladder.
 *    Since `executeAdvanceEra` clears `unlocked_techs`, that ladder is one they
 *    can never re-climb: measured, every seat advanced by turn 15 and then not
 *    one of them ever reached the Moon, let alone the worlds beyond it.
 *  • The player's era alone is wrong on a board-transform game, where the board
 *    IS the Space Age while a trailing player is still in the Modern day — their
 *    own era resolves to `none`, which would hand them the Moon for free.
 *
 * Taking the later of the two is right in both: it never relaxes what the board
 * demands, and it recognises a player who has climbed past it.
 */
export function resolveOrbitAccessModeForPlayer(
  state: GameState,
  player: PlayerState,
  map: GameMap,
  boardEra: EraId,
): OrbitAccessMode {
  // An explicit map declaration is the whole rule; era never enters into it.
  if (map.orbit_access) return map.orbit_access;
  const board = resolveOrbitAccessMode(map, boardEra);
  if (!state.settings?.era_advancement_enabled) return board;
  const own = resolveOrbitAccessMode(map, resolvePlayerEraId(state, player));
  return ORBIT_MODE_RANK[own] > ORBIT_MODE_RANK[board] ? own : board;
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
  const mode = resolveOrbitAccessModeForPlayer(state, player, map, era);
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
  //
  // Corridors: no tech gate. A player attacks across a lane from the gateway
  // tile they hold, and holding both ends of a lane is a corridor nobody else
  // can cross — which follows from the same rule, since crossing needs one end.
  // What keeps gateways contested is the lane dice cap (galaxyLaneAttackDiceCap),
  // not a key everyone buys on turn 1. The Chart gate below survives only for
  // games created with the kill switch off.
  if (state.settings?.galaxy_corridors_enabled) {
    return { allowed: true, missing: [], mode };
  }
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
  return { allowed: false, missing: ['Lane Charts tech'], mode };
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

/** True when (a,b) is an AUTHORED orbit lane — not one a Launch Pad opened. */
export function isAuthoredOrbitLaneBetween(map: GameMap, a: string, b: string): boolean {
  return (map.connections ?? []).some(
    (c) => isAuthoredOrbitLane(c) && ((c.from === a && c.to === b) || (c.from === b && c.to === a)),
  );
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
// Corridors — per-lane state, the lane dice cap, and the Emergency Seal
// ============================================================

/** Rounds a fresh Emergency Seal lasts. One: it buys a round, not a wall. */
export const GALAXY_LANE_SEAL_DURATION = 1;

/** Attacker dice across a hyperspace lane without Lane Charts. */
export const GALAXY_LANE_BASE_ATTACK_DICE = 2;

/**
 * Space Age Orbital Blockade (Moon Race, Phase 4).
 *
 * Two rounds rather than the Galaxy's three: the Space Age board is smaller and
 * a rival's answer — build a Launch Pad, fly your own lane — takes fewer turns,
 * so a longer seal would outlast the counterplay rather than buy time against it.
 */
export const SPACE_AGE_LANE_SEAL_DURATION = 2;

/**
 * He-3 a Space Age seal costs. The Galaxy's is free; here it ties defence to
 * the lunar economy, so a Hegemon spending on seals is a Hegemon not spending
 * on beams.
 */
export const SPACE_AGE_LANE_SEAL_HELIUM3_COST = 3;

/** How long a seal lasts in this era. */
export function laneSealDuration(state: GameState): number {
  return state.era === 'space_age' ? SPACE_AGE_LANE_SEAL_DURATION : GALAXY_LANE_SEAL_DURATION;
}

/** He-3 this era charges to seal. Zero outside the Space Age. */
export function laneSealHelium3Cost(state: GameState): number {
  return state.era === 'space_age' ? SPACE_AGE_LANE_SEAL_HELIUM3_COST : 0;
}

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

/** Territories that sit on an orbit lane — the galaxy's gateway tiles. */
export function orbitGatewayTerritoryIds(map: GameMap): Set<string> {
  const ids = new Set<string>();
  for (const c of map.connections) {
    if (c.type !== 'orbit') continue;
    ids.add(c.from);
    ids.add(c.to);
  }
  return ids;
}

export type LaneState = 'corridor' | 'open' | 'closed';

/**
 * A lane's state for one player, read live from who holds its two gateways:
 *   corridor — the player holds both ends; only they can cross it.
 *   open     — the player holds one end; they may attack across, and so may
 *              whoever holds the other end.
 *   closed   — the player holds neither end; their way in is intra-world.
 * Purely descriptive under corridors (the crossing rule is "hold one end"), but
 * it is what the chart paints, what the AI weighs, and what Lane Sovereignty
 * will count.
 */
export function laneStateFor(state: GameState, fromId: string, toId: string, playerId: string): LaneState {
  const a = state.territories[fromId]?.owner_id === playerId;
  const b = state.territories[toId]?.owner_id === playerId;
  if (a && b) return 'corridor';
  if (a || b) return 'open';
  return 'closed';
}

/**
 * Attacker dice ceiling for an attack across a hyperspace lane, or undefined
 * when no lane cap applies (corridors off, or not a galaxy game).
 *
 * Two dice is the sea-lane precedent: a defended gateway then holds like a
 * coast, and the 16 gateway tiles become the places worth fighting over. Lane
 * Charts (the tier-1 tech that used to be the access gate) restores the third
 * die, and the galaxy's later attack-dice techs stack on top as bonuses.
 */
export function galaxyLaneAttackDiceCap(state: GameState, attackerId: string): number | undefined {
  // The setting is only ever baked for Galactic Age games (games.routes.ts), so
  // it is the era check as well; callers without the map can still ask.
  if (!state.settings?.galaxy_corridors_enabled) return undefined;
  // The Hyperlane Anchor used to skip the Chart gate; under corridors there is
  // no gate, so the wonder lifts the lane cap instead — its owner's crossings
  // roll full dice, like a same-world attack.
  if (playerOwnsHyperlaneAnchor(state, attackerId)) return undefined;
  const attacker = state.players.find((p) => p.player_id === attackerId);
  const hasLaneCharts = state.settings.tech_trees_enabled
    && (attacker?.unlocked_techs?.includes('ga_hyperspace_chart') ?? false);
  return GALAXY_LANE_BASE_ATTACK_DICE + (hasLaneCharts ? 1 : 0);
}

/** True when any territory the player holds carries the Hyperlane Anchor wonder. */
export function playerOwnsHyperlaneAnchor(state: GameState, playerId: string): boolean {
  return Object.values(state.territories).some(
    (t) => t.owner_id === playerId && (t.buildings?.includes('wonder_hyperlane_anchor') ?? false),
  );
}

/**
 * True when an active lane seal owned by ANOTHER player blocks `playerId` from
 * crossing the orbit edge from→to. The sealer can still use their own lane.
 */
export function isLaneSealedForPlayer(state: GameState, fromId: string, toId: string, playerId: string): boolean {
  // Lane weather (a Nebula Closure) shuts a lane for EVERYONE, including the
  // owners of its gateways — it is not a seal and no charge lifts it.
  if (isLaneClosedByWeather(state, fromId, toId)) return true;
  const bl = state.lane_blockades?.[orbitLaneId(fromId, toId)];
  if (!bl || bl.turns_remaining <= 0) return false;
  return bl.owner_id !== playerId;
}

export interface SealLaneCheck { ok: boolean; error?: string; laneId?: string }

/** The faction ability id that grants Emergency Seal. */
export const EMERGENCY_SEAL_ABILITY_ID = 'emergency_seal';

/** The world whose lanes Emergency Seal may close. */
const EMERGENCY_SEAL_WORLD_ID = 'nexus_station';

/**
 * Validate whether `playerId` may seal the orbit lane (from,to) right now.
 *
 * TWO mechanics come through here, and they are not variants of each other:
 *
 *  • The Space Age **Orbital Blockade** (Moon Race, Phase 4) is a purchase. Any
 *    player holding an end of an AUTHORED anchor lane may close it for He-3.
 *    The Launch Pad exclusion is the rule the whole phase rests on — the anchors
 *    are the convenient route and may be denied, the pad is the contest route
 *    and stays open, so a Hegemon can make you build a pad but can never lock
 *    you out.
 *  • The Galactic Age **Emergency Seal** is a faction charge. The Void
 *    Custodians (and whoever holds the Nexus Vault) close a lane once a turn,
 *    for free. It replaced a sealing rule open to every player, which lasted
 *    three rounds and was never used by the AI — a wall nobody on the other side
 *    of the table could see or answer.
 *
 * The era decides which set applies, because a board that carries both (Space to
 * Stars) has no Galactic Age lanes until somebody ascends, and the Space Age
 * rules are the ones its authored lanes were measured under.
 */
export function canSealLane(
  state: GameState,
  map: GameMap,
  fromId: string,
  toId: string,
  playerId: string,
  /** Galactic Age only: the acting player's faction ability, for Emergency Seal. */
  factionAbilityId?: string,
  options?: {
    /** The player holds a Vault that grants the seal — any lane, not just Nexus's. */
    vaultHolder?: boolean;
  },
): SealLaneCheck {
  if (!isOrbitLane(map, fromId, toId)) return { ok: false, error: 'Not a hyperspace lane' };
  const id = orbitLaneId(fromId, toId);
  const blockades = state.lane_blockades ?? {};

  if (state.era === 'space_age') {
    if (!state.settings?.lanes_contestable_enabled) {
      return { ok: false, error: 'Lane seals are not enabled' };
    }
    // ONLY the authored anchor lanes can be sealed. `syncLaunchPadLanes` writes
    // a Launch Pad's own lane into `map.connections` with `type: 'orbit'`, so
    // without this a Hegemon could seal the very route a rival built to come and
    // contest them, and the cost to contest an occupied Moon would once again be
    // unbounded.
    if (!isAuthoredOrbitLaneBetween(map, fromId, toId)) {
      return { ok: false, error: 'Launch Pad lanes cannot be blockaded — only the authored orbit lanes' };
    }
    const cost = laneSealHelium3Cost(state);
    const stock = state.players.find((p) => p.player_id === playerId)?.helium3 ?? 0;
    if (stock < cost) {
      return { ok: false, error: `Sealing a lane needs ${cost} Helium-3 (you have ${stock})` };
    }
    const ownsEndpoint =
      state.territories[fromId]?.owner_id === playerId || state.territories[toId]?.owner_id === playerId;
    if (!ownsEndpoint) return { ok: false, error: 'You must hold one end of the lane to seal it' };
    // One active seal per player (refreshing your own lane is allowed).
    const otherActive = Object.entries(blockades).some(
      ([lid, b]) => lid !== id && b.owner_id === playerId && b.turns_remaining > 0,
    );
    if (otherActive) return { ok: false, error: 'You already have a lane sealed — wait for it to lift' };
  } else {
    const viaFaction = factionAbilityId === EMERGENCY_SEAL_ABILITY_ID;
    const viaVault = options?.vaultHolder === true;
    if (!viaFaction && !viaVault) {
      return { ok: false, error: 'Emergency Seal is a Void Custodians ability, or the Vault holder\'s' };
    }
    const touchesNexus = [fromId, toId].some((tid) => {
      const t = map.territories.find((tt) => tt.territory_id === tid);
      return !!t && inferWorldId(t) === EMERGENCY_SEAL_WORLD_ID;
    });
    if (!viaVault && !touchesNexus) {
      return { ok: false, error: 'Emergency Seal only closes lanes that touch Nexus Station' };
    }
  }

  const existing = blockades[id];
  if (existing && existing.turns_remaining > 0 && existing.owner_id !== playerId) {
    return { ok: false, error: 'This lane is already sealed by a rival' };
  }
  return { ok: true, laneId: id };
}

/** Which clock a seal raised in this era ages on — see `GameState.lane_blockades`. */
export function laneSealTick(state: GameState): 'round' | 'owner_turn' {
  return state.era === 'space_age' ? 'round' : 'owner_turn';
}

/**
 * Age lane seals by one round and drop the expired.
 *
 * Called twice per round, on the two clocks a seal can be on (see
 * `GameState.lane_blockades`):
 *   • `tickLaneBlockades(state)` at the ROUND WRAP ages Space Age Orbital
 *     Blockades — and, being the legacy shape, anything a pre-existing save
 *     recorded without a clock.
 *   • `tickLaneBlockades(state, ownerId)` at that player's TURN START ages the
 *     Galactic Age's seals. "One round" then means the same thing for every
 *     seat: the seal stands through each rival's turn and lifts as the sealer
 *     comes back round. Ticking those at the wrap instead made a seal placed by
 *     the last seat in turn order expire before anyone had to face it.
 */
export function tickLaneBlockades(state: GameState, ownerId?: string): void {
  if (!state.lane_blockades) return;
  for (const [id, b] of Object.entries(state.lane_blockades)) {
    const clock = b.tick ?? 'round';
    if (ownerId === undefined) {
      if (clock !== 'round') continue;
    } else {
      if (clock !== 'owner_turn' || b.owner_id !== ownerId) continue;
    }
    // A seal outlives its owner's presence otherwise: they can be thrown off
    // both ends of the lane and it stays shut for the rest of its duration,
    // which is a blockade nobody is mounting. Holding an endpoint is what
    // `canSealLane` requires to raise one, so it is what keeping one requires
    // too. (Moon Race, Phase 4 §6.2(5) — the Galaxy inherits the same fix.)
    const [endA, endB] = id.split('::');
    const territoryA = state.territories[endA ?? ''];
    const territoryB = state.territories[endB ?? ''];
    // Only judge ownership when both endpoints actually resolve. A lane id that
    // does not name two live territories tells us nothing about who holds it,
    // and dropping a seal on that basis would be guessing — it expires on its
    // own duration regardless.
    if (territoryA && territoryB) {
      const stillHoldsAnEnd =
        territoryA.owner_id === b.owner_id || territoryB.owner_id === b.owner_id;
      if (!stillHoldsAnEnd) {
        delete state.lane_blockades[id];
        continue;
      }
    }
    b.turns_remaining -= 1;
    if (b.turns_remaining <= 0) delete state.lane_blockades[id];
  }
}

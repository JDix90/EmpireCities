// ============================================================
// Galactic Age board modes — one map, a start for each seat count
// ============================================================
//
// The Galactic Age is four worlds in a ring, one per faction, and its classic
// start gives each of four players their whole home world. A board MODE is a
// different starting layout on the same map, picked by how many seats the game
// has. It is recorded on the state (`state.galaxy_mode`) rather than forking the
// rules: once the board is laid out, every rule the era has plays unchanged.
//
//   Colonies (2–3 seats) — every player still starts on their faction's home
//       world, and the worlds nobody calls home start NEUTRAL and garrisoned, as
//       colonies to take. At three seats the two gaps in the ring are bridged
//       for the whole game, by the same lanes a Lane Surge opens for two rounds
//       (galaxyRing.ts): without them the seat in the middle of the three
//       borders both rivals and never touches the colony.
//
// Colonies needs home worlds, so it plays only with factions on (the lobby's
// "Home Worlds"). Without them every seat count gets the scattered deal. The
// modes planned for five to eight seats are in docs/GALACTIC_AGE_MODES.md.

import type { EraId, GameMap, GameState, MapConnection } from '../../types';
import { getEraFactions } from '../eras';
import { GALAXY_MODE_LANE_SOURCE, ringGapLanes } from './galaxyRing';
import { orbitLaneId } from './moonAccess';

/** The four `era_galaxy` world ids — each is one lore faction's home world. */
export const GALAXY_HOME_WORLD_IDS: ReadonlySet<string> = new Set<string>([
  'sol',
  'verdan',
  'rust',
  'nexus_station',
]);

/** Seats a Galactic Age game supports: Colonies at two and three, the classic start at four. */
export const GALAXY_MIN_SEATS = 2;
export const GALAXY_MAX_SEATS = 4;

/**
 * A colony world's opening garrison: its gateway tiles (the ends of its lanes,
 * where a colonist lands) and the tiles behind them. ⚠ Balance: swept at two
 * and three seats in backend/scripts/GALAXY-BALANCE.md; the sim's
 * SIM_COLONY_GARRISON patches this object. A Vault region keeps its own
 * authored garrison on a colony world, as it does on a home world.
 */
export const COLONY_GARRISONS = { gateway: 5, interior: 7 };

export type GalaxyModeState = NonNullable<GameState['galaxy_mode']>;

/**
 * Each player's home world, in player order, when this game deals home worlds:
 * the Galactic Age on its galaxy map, two to four seats, and every seat on a
 * faction whose home regions all lie on one of the four worlds, no two sharing a
 * world. Null otherwise, and the caller falls back to the geographic deal.
 */
export function resolveGalaxyHomeWorlds(
  era: EraId,
  map: GameMap,
  players: ReadonlyArray<{ faction_id?: string | null }>,
): string[] | null {
  if (era !== 'galaxy_age' || map.map_kind !== 'galaxy') return null;
  if (players.length < GALAXY_MIN_SEATS || players.length > GALAXY_MAX_SEATS) return null;

  const byFactionId = new Map(getEraFactions(era).map((f) => [f.faction_id, f]));
  const worlds: string[] = [];
  for (const p of players) {
    if (!p.faction_id) return null;
    const fac = byFactionId.get(p.faction_id);
    if (!fac?.home_region_ids?.length) return null;
    // The galaxy map splits each world into several bonus regions, so a
    // faction's home regions must all live on one world.
    const homeRegions = new Set(fac.home_region_ids);
    const found = new Set<string>();
    for (const t of map.territories) {
      if (t.region_id && homeRegions.has(t.region_id) && t.world_id) found.add(t.world_id);
    }
    if (found.size !== 1) return null;
    const worldId = [...found][0]!;
    if (!GALAXY_HOME_WORLD_IDS.has(worldId)) return null;
    worlds.push(worldId);
  }
  if (new Set(worlds).size !== worlds.length) return null;
  return worlds;
}

/**
 * The Colonies layout for these home worlds, or null for the classic start
 * (every world has a player). Neutral worlds are sorted; the three-seat lanes
 * come from `ringGapLanes`, in the order a Lane Surge would try them.
 */
export function colonyLayout(map: GameMap, homeWorlds: readonly string[]): GalaxyModeState | null {
  const claimed = new Set(homeWorlds);
  const neutralWorlds = [...GALAXY_HOME_WORLD_IDS].filter((w) => !claimed.has(w)).sort();
  if (neutralWorlds.length === 0) return null;
  const lanes = homeWorlds.length === 3 ? ringGapLanes(map) : [];
  return {
    id: 'colonies',
    neutral_worlds: neutralWorlds,
    ...(lanes.length > 0 ? { lanes } : {}),
  };
}

/** A colony tile's opening garrison: gateways (on a lane) hold fewer than the interior. */
export function colonyGarrison(isGateway: boolean): number {
  return isGateway ? COLONY_GARRISONS.gateway : COLONY_GARRISONS.interior;
}

/** The lanes this game's board mode keeps open all game. */
export function galaxyModeConnections(state: GameState): MapConnection[] {
  return (state.galaxy_mode?.lanes ?? []).map((l) => ({
    from: l.from,
    to: l.to,
    type: 'orbit' as const,
    source: GALAXY_MODE_LANE_SOURCE,
  }));
}

/**
 * Bring the game's map copy in line with the board mode's lanes. They never
 * change during a game, so after the first call this only matters for a room
 * rebuilt from the authored map (Postgres recovery), which must regain them.
 * Mirrors `syncLaneWeatherLanes`, including replacing the array rather than
 * mutating it (consumers cache adjacency keyed on `map.connections` identity).
 * Returns true when it changed the map.
 */
export function syncGalaxyModeLanes(map: GameMap, state: GameState): boolean {
  const wanted = galaxyModeConnections(state);
  const wantedKeys = new Set(wanted.map((c) => orbitLaneId(c.from, c.to)));
  const existing = map.connections.filter((c) => c.source === GALAXY_MODE_LANE_SOURCE);
  const existingKeys = new Set(existing.map((c) => orbitLaneId(c.from, c.to)));
  const stale = existing.filter((c) => !wantedKeys.has(orbitLaneId(c.from, c.to)));
  const missing = wanted.filter((c) => !existingKeys.has(orbitLaneId(c.from, c.to)));
  if (stale.length === 0 && missing.length === 0) return false;
  const staleKeys = new Set(stale.map((c) => orbitLaneId(c.from, c.to)));
  map.connections = [
    ...map.connections.filter(
      (c) => c.source !== GALAXY_MODE_LANE_SOURCE || !staleKeys.has(orbitLaneId(c.from, c.to)),
    ),
    ...missing,
  ];
  return true;
}

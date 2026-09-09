/**
 * Frontend-side orbit access helpers — purely advisory; the backend remains the
 * sole authority on whether a claim/attack/fortify across an orbit edge is
 * accepted (`backend/src/game-engine/state/moonAccess.ts`). These helpers exist
 * to drive UI hints (TerritoryPanel banner, GalaxyStrategicView lane coloring)
 * so the player understands gating before they click an action that the server
 * would reject.
 *
 * Keep the rules in sync with `getOrbitAccessResult` on the backend:
 *   - `space_age_moon`: needs Lunar Expansion tech + Launch Pad building +
 *     either a launched Space Station or the Space Elevator wonder, OR be the
 *     Lunar Pioneers faction.
 *   - `galaxy_hyperspace`: needs `ga_hyperspace_chart` tech, OR own the
 *     Hyperlane Anchor wonder, OR be the Helion Navigators faction.
 */

import { inferWorldId } from '@borderfall/shared';
import type { GameState } from '../store/gameStore';

export type OrbitAccessMode = 'none' | 'space_age_moon' | 'galaxy_hyperspace';

export interface FrontendMapTerritory {
  territory_id: string;
  region_id: string;
  world_id?: string;
  globe_id?: string;
  /** Present on real map documents; the orbit helpers only use it for copy. */
  name?: string;
}

export interface FrontendMapWorld {
  world_id: string;
  requires_orbit_access?: boolean;
}

export interface FrontendMapData {
  map_id?: string;
  map_kind?: 'standard' | 'galaxy';
  worlds?: FrontendMapWorld[];
  orbit_access?: OrbitAccessMode;
  territories: FrontendMapTerritory[];
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit'; source?: 'launch_pad' }>;
}

/**
 * The Moon tile a Launch Pad on `territoryId` opens (or has opened) a lane to.
 * Mirrors `nearestLandingZoneFor` on the backend: fewest hops over the map's
 * connections from the pad to an authored orbit lane's Earth end. Advisory
 * only — the server adds the real lane when the pad is built.
 */
export function launchPadLaneTarget(
  mapData: FrontendMapData | null | undefined,
  territoryId: string,
): string | null {
  if (!mapData) return null;
  const existing = mapData.connections.find(
    (c) => c.source === 'launch_pad' && (c.from === territoryId || c.to === territoryId),
  );
  if (existing) return existing.from === territoryId ? existing.to : existing.from;
  const byId = new Map(mapData.territories.map((t) => [t.territory_id, t]));
  const origin = byId.get(territoryId);
  if (!origin || inferWorldId(origin) !== 'earth') return null;
  const zones: Array<{ earthAnchor: string; moonTarget: string }> = [];
  for (const c of mapData.connections) {
    if (c.type !== 'orbit' || c.source === 'launch_pad') continue;
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    if (inferWorldId(from) === 'earth' && inferWorldId(to) !== 'earth') zones.push({ earthAnchor: c.from, moonTarget: c.to });
    else if (inferWorldId(to) === 'earth' && inferWorldId(from) !== 'earth') zones.push({ earthAnchor: c.to, moonTarget: c.from });
  }
  if (zones.length === 0) return null;
  const adj = new Map<string, string[]>();
  for (const c of mapData.connections) {
    (adj.get(c.from) ?? adj.set(c.from, []).get(c.from)!).push(c.to);
    (adj.get(c.to) ?? adj.set(c.to, []).get(c.to)!).push(c.from);
  }
  const visited = new Set([territoryId]);
  let frontier = [territoryId];
  while (frontier.length > 0) {
    const hit = zones.find((z) => frontier.includes(z.earthAnchor));
    if (hit) return hit.moonTarget;
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!visited.has(n)) { visited.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return null;
}

export function resolveOrbitAccessMode(
  mapData: FrontendMapData | null | undefined,
  era: string,
): OrbitAccessMode {
  if (!mapData) return 'none';
  if (mapData.orbit_access) return mapData.orbit_access;
  if (era === 'galaxy_age') return 'galaxy_hyperspace';
  if (era === 'space_age') return 'space_age_moon';
  return 'none';
}

export interface OrbitAccessResult {
  allowed: boolean;
  missing: string[];
}

/** One step of the Space Age Moon ladder, as the player has to perform it. */
export interface SpaceProgramRung {
  key: string;
  label: string;
  done: boolean;
  /** Shown under the label once it matters (the lane a built pad opened). */
  detail?: string;
}

export interface SpaceProgramProgress {
  /** False outside the Space Age Moon gate — nothing to show. */
  applicable: boolean;
  isLunarPioneer: boolean;
  allowed: boolean;
  rungs: SpaceProgramRung[];
  /**
   * Access was earned and then lost with the last Launch Pad. Worth calling out
   * separately: the player keeps their Moon holdings and can still fight and
   * reinforce there, but cannot cross a lane until they rebuild.
   */
  strandedWithoutPad: boolean;
  /**
   * Whether they demonstrably held a pad at some point, which decides whether
   * the stranded copy should say the pad is *gone* or that they still need one.
   * Launching the station required a pad, so a launch proves it. The Space
   * Elevator does not: it replaces the launch, not the pad, and a player can
   * build it having never had one — the exact path that made a mobile tester
   * think the wonder granted Moon access on its own.
   */
  everHadPad: boolean;
}

/**
 * The Moon ladder as five things the player does, rather than the three the
 * server gates on: Spaceport Infrastructure and Orbital Station Program are
 * prerequisites the player must buy but that the gate never names, so a
 * tracker built only from `missing` would tell them to launch a Space Station
 * without saying how to unlock the launch.
 */
export function getSpaceProgramProgress(
  mapData: FrontendMapData | null | undefined,
  gameState: GameState | null,
  playerId: string | null | undefined,
  era: string,
): SpaceProgramProgress {
  const empty: SpaceProgramProgress = {
    applicable: false, isLunarPioneer: false, allowed: true, rungs: [], strandedWithoutPad: false,
    everHadPad: false,
  };
  if (resolveOrbitAccessMode(mapData, era) !== 'space_age_moon') return empty;
  if (!gameState || !playerId) return empty;
  const player = gameState.players.find((p) => p.player_id === playerId);
  if (!player) return empty;

  const isLunarPioneer = player.faction_id === 'lunar_pioneers';
  const techs = player.unlocked_techs ?? [];
  const owned = Object.values(gameState.territories).filter((t) => t.owner_id === playerId);
  const padTerritory = owned.find((t) => t.buildings?.includes('launch_pad') ?? false);
  const hasElevator = owned.some((t) => t.buildings?.includes('wonder_space_elevator') ?? false);
  const hasLaunchedStation = player.space_station_launched === true;
  const hasTech = techs.includes('sa_lunar_expansion');

  const padDetail = padTerritory
    ? (() => {
        const moonId = launchPadLaneTarget(mapData, padTerritory.territory_id);
        const moonName = moonId
          ? mapData?.territories.find((t) => t.territory_id === moonId)?.name ?? moonId
          : null;
        const padName = mapData?.territories.find((t) => t.territory_id === padTerritory.territory_id)?.name
          ?? padTerritory.territory_id;
        return moonName ? `${padName} → ${moonName}` : padName;
      })()
    : undefined;

  const rungs: SpaceProgramRung[] = [
    { key: 'sa_launch_pad_tech', label: 'Research Spaceport Infrastructure', done: techs.includes('sa_launch_pad_tech') },
    { key: 'launch_pad', label: 'Build a Launch Pad', done: !!padTerritory, detail: padDetail },
    { key: 'sa_space_station', label: 'Research Orbital Station Program', done: techs.includes('sa_space_station') },
    {
      key: 'launch',
      label: hasElevator ? 'Space Elevator built' : 'Launch the Space Station',
      done: hasLaunchedStation || hasElevator,
      // The launch button is hidden outside draft/fortify and rejected without
      // a pad, in both cases silently. Say so here, where the player is already
      // looking for what to do next.
      detail: hasLaunchedStation || hasElevator
        ? undefined
        : techs.includes('sa_space_station')
          ? (padTerritory
              ? 'Ready — use the Launch Space Station button during draft or fortify'
              : 'Needs a Launch Pad first')
          : undefined,
    },
    { key: 'sa_lunar_expansion', label: 'Research Lunar Expansion', done: hasTech },
  ];

  return {
    applicable: true,
    isLunarPioneer,
    allowed: isLunarPioneer || (hasTech && !!padTerritory && (hasLaunchedStation || hasElevator)),
    rungs,
    strandedWithoutPad: !isLunarPioneer && hasTech && (hasLaunchedStation || hasElevator) && !padTerritory,
    everHadPad: hasLaunchedStation,
  };
}

/** Lane id, matching the backend's `orbitLaneId` ordering. */
function orbitLaneId(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Client mirror of the backend `fortifyTraversalFilter`: may this player move
 * troops across this connection right now?
 *
 * Only orbit lanes are ever refused, and for the two reasons the server refuses
 * them — no orbit access, or the lane is sealed against the player. Everything
 * else passes, so interior movement on either world is untouched.
 *
 * This exists because the fortify BFS stopped walking orbit lanes freely: the
 * server now refuses a lane the player cannot cross even when the fortify's own
 * endpoints are ordinary land tiles, so a client BFS that still walks them
 * reports Moon tiles as reachable to a player who has no Launch Pad.
 *
 * Advisory, like everything else here — the server remains the authority.
 */
export function fortifyTraversalFilter(
  mapData: FrontendMapData | null | undefined,
  gameState: GameState | null,
  playerId: string | null | undefined,
  era: string,
): (conn: { from: string; to: string; type?: string }) => boolean {
  if (resolveOrbitAccessMode(mapData, era) === 'none' || !gameState || !playerId) {
    return () => true;
  }
  const access = getOrbitAccessResult(mapData, gameState, playerId, era);
  const sealsOn = gameState.settings?.lanes_contestable_enabled === true;
  const blockades = gameState.lane_blockades ?? {};
  return (conn) => {
    if (conn.type !== 'orbit') return true;
    if (!access.allowed) return false;
    if (!sealsOn) return true;
    // Mirrors isLaneSealedForPlayer: an expired or absent seal blocks nobody,
    // and the player who set it can still cross their own.
    const seal = blockades[orbitLaneId(conn.from, conn.to)];
    const sealed = !!seal && seal.turns_remaining > 0 && seal.owner_id !== playerId;
    return !sealed;
  };
}

export function getOrbitAccessResult(
  mapData: FrontendMapData | null | undefined,
  gameState: GameState | null,
  playerId: string | null | undefined,
  era: string,
): OrbitAccessResult {
  const mode = resolveOrbitAccessMode(mapData, era);
  if (mode === 'none' || !gameState || !playerId) return { allowed: true, missing: [] };

  const player = gameState.players.find((p) => p.player_id === playerId);
  if (!player) return { allowed: true, missing: [] };

  if (mode === 'space_age_moon') {
    if (player.faction_id === 'lunar_pioneers') return { allowed: true, missing: [] };
    const missing: string[] = [];
    const techs = player.unlocked_techs ?? [];
    const hasTech = techs.includes('sa_lunar_expansion');
    const ownedTerritories = Object.values(gameState.territories).filter(
      (t) => t.owner_id === playerId,
    );
    const hasLaunchPad = ownedTerritories.some(
      (t) => t.buildings?.includes('launch_pad') ?? false,
    );
    const hasSpaceElevator = ownedTerritories.some(
      (t) => t.buildings?.includes('wonder_space_elevator') ?? false,
    );
    const hasLaunchedStation = player.space_station_launched === true;
    if (!hasTech) missing.push('Lunar Expansion tech');
    if (!hasLaunchPad) missing.push('Launch Pad building');
    if (!hasLaunchedStation && !hasSpaceElevator) missing.push('launched Space Station');
    return { allowed: missing.length === 0, missing };
  }

  // galaxy_hyperspace
  if (player.faction_id === 'helion_navigators') return { allowed: true, missing: [] };
  const ownedTerritories = Object.values(gameState.territories).filter(
    (t) => t.owner_id === playerId,
  );
  const hasAnchor = ownedTerritories.some(
    (t) => t.buildings?.includes('wonder_hyperlane_anchor') ?? false,
  );
  if (hasAnchor) return { allowed: true, missing: [] };
  const techs = player.unlocked_techs ?? [];
  if (techs.includes('ga_hyperspace_chart')) return { allowed: true, missing: [] };
  return { allowed: false, missing: ['Hyperspace Chart tech'] };
}

/**
 * True when claiming/attacking this territory crosses an orbit-locked edge
 * (Moon, or galaxy worlds flagged `requires_orbit_access`).
 */
export function territoryRequiresOrbitAccessForClaim(
  mapData: FrontendMapData | null | undefined,
  territoryId: string,
): boolean {
  if (!mapData) return false;
  const t = mapData.territories.find((tt) => tt.territory_id === territoryId);
  if (!t) return false;
  const wid = inferWorldId(t);
  const def = mapData.worlds?.find((w) => w.world_id === wid);
  if (def && typeof def.requires_orbit_access === 'boolean') return def.requires_orbit_access;
  return wid === 'moon';
}

export function formatOrbitAccessError(access: OrbitAccessResult, mode: OrbitAccessMode): string {
  if (access.allowed) return '';
  if (mode === 'galaxy_hyperspace') {
    return access.missing.length === 0
      ? 'Hyperspace travel locked'
      : `Hyperspace travel requires: ${access.missing.join(' + ')}`;
  }
  if (mode === 'space_age_moon') {
    return access.missing.length === 0
      ? 'Moon access locked'
      : `Moon access requires: ${access.missing.join(' + ')}`;
  }
  return access.missing.length === 0 ? 'Orbit access locked' : `Requires: ${access.missing.join(' + ')}`;
}

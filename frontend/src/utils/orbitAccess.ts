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
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
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

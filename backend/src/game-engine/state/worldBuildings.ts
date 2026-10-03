// ============================================================
// World buildings — one per world rule, and a toll on the lanes
// ============================================================
//
// Galactic Age buildings, Phase 5 (docs/GALACTIC_AGE_BUILDINGS.md §7). Each
// world's rule changes a decision (worldRules.ts); these give each rule a
// building, so the decision has something to buy:
//
//   Habitat Dome   the Cradle world (Sol III)   the muster refills this tile one
//                                               unit higher (2 → 3)          5 PP
//   Storm Shelter  the storm world (Verdan)     the storms strike this tile only
//                                               above 18, not 12, so a defended
//                                               gateway on Verdan can stand  5 PP
//   Vault Conduit  a Vault tile (Gate Ring),    +1 TP/turn while its owner
//                  one a Vault                  holds the whole Vault        6 PP
//   Toll Beacon    any gateway, one a lane      +1 PP/turn while its lane is
//                                               its owner's corridor         6 PP
//
// Rust needs nothing new: the forge die and half-price builds are already its
// identity, and a Toll Beacon on a Rust gateway costs half like any building.
//
// Each is its own building id and its own one-per-tile category, opened by
// Lattice Logistics (the tree's tier-1 economic root) in a game that plays
// them. The rules read the Dome and the Shelter through the per-tile threshold
// in worldRules.ts; the Conduit and the Beacon pay in the production tick
// (economyManager.collectProduction), flat like the Vault's own pay. Each pays
// once for what it taxes: a Vault carries one Conduit and a lane one Beacon. As
// first shipped a Conduit stood on every Vault tile and each paid, so a full
// set tripled the Vault's 2 TP, and at eight seats that tech made the Nexus
// houses the strongest at the table (docs/GALACTIC_AGE_BUILDINGS.md §7). On capture
// they follow Phase 2: on a gateway under orbital infrastructure they pass to
// the captor, and everywhere else they are razed.
//
// A gateway's lanes are stamped onto state (`lane_partners`) when it enters
// play, as Phase 2 stamps `gateway`, because the build check and the production
// tick hold state and no map. Only authored lanes count: the corridors Lane
// Sovereignty is played on, not a Jump Gate's, a Lane Surge's or a Colonies
// bridge.
//
// Gated by `settings.galaxy_world_buildings`, baked at create from the
// `galaxy_world_buildings_enabled` flag, so a flip never re-rules a match in
// progress. Off, every path refuses them and no territory carries the stamp.

import {
  GALAXY_WORLD_BUILDING_COSTS,
  GALAXY_WORLD_BUILDING_EFFECTS,
  isGalaxyWorldBuilding,
} from '@borderfall/shared';
import type { GameMap, GameState, MapConnection, TerritoryState } from '../../types';
import { authoredLanes } from './galaxyRing';
import { isFriendlyOwner } from './teams';
import { getWorldRules, vaultStatuses } from './worldRules';

/** True when this game plays the world buildings. */
export function worldBuildingsEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.galaxy_world_buildings === true;
}

/**
 * A world building's own price, for an economy snapshot (or an operator's cost
 * override) written before the building existed. Undefined for every other id,
 * so their costs resolve exactly as they always did.
 */
export function worldBuildingDefaultCost(buildingType: string): number | undefined {
  return isGalaxyWorldBuilding(buildingType) ? GALAXY_WORLD_BUILDING_COSTS[buildingType] : undefined;
}

/**
 * Stamp each gateway among `territories` with the far ends of its authored
 * lanes (in place). A partner not yet in play (Space to Stars) is recorded all
 * the same: it is a corridor only once someone holds it. Idempotent.
 */
export function stampLanePartners(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  lanes: MapConnection[] = authoredLanes(map),
): void {
  const add = (id: string, partner: string): void => {
    const t = territories[id];
    if (!t) return;
    const partners = t.lane_partners ?? [];
    if (!partners.includes(partner)) t.lane_partners = [...partners, partner].sort();
  };
  for (const c of lanes) {
    add(c.from, c.to);
    add(c.to, c.from);
  }
}

/**
 * Where a world building may stand. Returns the refusal, or null when the
 * placement is legal — and null for every building that is not one of these.
 * Cost, tech and the one-per-tile slot are the caller's (validateBuild).
 */
export function checkWorldBuildingPlacement(
  state: GameState,
  territory: Pick<TerritoryState, 'world_id' | 'region_id' | 'lane_partners'>,
  buildingType: string,
): string | null {
  if (!isGalaxyWorldBuilding(buildingType)) return null;
  if (!worldBuildingsEnabled(state)) return 'World buildings are not part of this game';
  const rules = getWorldRules(state, territory.world_id);
  switch (buildingType) {
    case 'habitat_dome':
      return rules.muster_threshold != null ? null : 'A Habitat Dome stands only on the Cradle world, Sol III';
    case 'storm_shelter':
      return rules.storm_threshold != null ? null : 'A Storm Shelter stands only on the storm world, Verdan Reach';
    case 'vault_conduit':
      if (!rules.vault || territory.region_id !== rules.vault.region_id) {
        return 'A Vault Conduit stands only on a Vault tile, the Gate Ring';
      }
      // One Conduit a Vault: it pays for the Vault, not for the tile.
      return vaultHasConduit(state, territory.world_id, rules.vault.region_id)
        ? 'This Vault already carries a Vault Conduit'
        : null;
    case 'toll_beacon':
      if ((territory.lane_partners?.length ?? 0) === 0) return 'A Toll Beacon stands only on a gateway';
      // One toll a lane: a corridor held at both ends is one corridor, not two.
      return laneHasTollBeacon(state, territory)
        ? 'This lane already carries a Toll Beacon at its other end'
        : null;
  }
}

/** Does a Toll Beacon already stand at the far end of one of this gateway's lanes? */
export function laneHasTollBeacon(state: GameState, territory: Pick<TerritoryState, 'lane_partners'>): boolean {
  return (territory.lane_partners ?? []).some((p) => (state.territories[p]?.buildings ?? []).includes('toll_beacon'));
}

/** Does this tile's Toll Beacon pay: is one of its lanes its owner's corridor (both ends friendly)? */
export function tollBeaconPays(state: GameState, territory: Pick<TerritoryState, 'owner_id' | 'lane_partners'>): boolean {
  const owner = territory.owner_id;
  if (!owner) return false;
  return (territory.lane_partners ?? []).some((p) => isFriendlyOwner(state, owner, state.territories[p]?.owner_id));
}

/** PP a turn from this player's Toll Beacons whose lanes are their corridors. */
export function tollBeaconProductionIncome(state: GameState, playerId: string): number {
  if (!worldBuildingsEnabled(state)) return 0;
  let paying = 0;
  for (const t of Object.values(state.territories)) {
    if (t.owner_id !== playerId || !(t.buildings ?? []).includes('toll_beacon')) continue;
    if (tollBeaconPays(state, t)) paying += 1;
  }
  return paying * GALAXY_WORLD_BUILDING_EFFECTS.tollBeaconProductionIncome;
}

/** Does a Vault Conduit stand on any tile of this Vault, whoever holds it? */
export function vaultHasConduit(state: GameState, worldId: string | undefined | null, regionId: string): boolean {
  return Object.values(state.territories).some((t) =>
    t.world_id === worldId && t.region_id === regionId && (t.buildings ?? []).includes('vault_conduit'));
}

/**
 * TP a turn from the Vaults this player holds whole that carry a Conduit: once
 * a Vault, however many stand on it (a second cannot be built, but the rule
 * pays for the Vault, not the count).
 */
export function vaultConduitTechIncome(state: GameState, playerId: string): number {
  if (!worldBuildingsEnabled(state)) return 0;
  let vaults = 0;
  for (const v of vaultStatuses(state)) {
    if (v.holder_id === playerId && vaultHasConduit(state, v.world_id, v.region_id)) vaults += 1;
  }
  return vaults * GALAXY_WORLD_BUILDING_EFFECTS.vaultConduitTechIncome;
}

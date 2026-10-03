/**
 * Galactic Age world buildings on the client (docs/GALACTIC_AGE_BUILDINGS.md §7).
 *
 * The server (backend state/worldBuildings.ts) decides; this restates where
 * each may stand so the build panel offers it only on a system where it can,
 * rather than listing four world-bound buildings on every system of the map:
 *
 *   Habitat Dome   a system on the Cradle world (a world with a muster rule);
 *   Storm Shelter  a system on the storm world (a world with a storm rule);
 *   Vault Conduit  a system of the Vault region (the Gate Ring);
 *   Toll Beacon    a gateway (the server stamps `lane_partners` on each); a
 *                  lane carries one, which the panel says rather than hides.
 */
import { isGalaxyWorldBuilding, type WorldRules } from '@borderfall/shared';

export interface WorldBuildingContext {
  /** The system's world and region, from the map. */
  worldId?: string;
  regionId?: string;
  /** The far ends of its authored lanes, as the server stamped them. */
  lanePartners?: string[];
  /** The game's world rules snapshot (`settings.world_rules`). */
  worldRules?: Record<string, WorldRules>;
}

/** Can this world building stand on this system? True for every other building. */
export function worldBuildingApplies(buildingId: string, ctx: WorldBuildingContext): boolean {
  if (!isGalaxyWorldBuilding(buildingId)) return true;
  const rules: WorldRules = (ctx.worldId ? ctx.worldRules?.[ctx.worldId] : undefined) ?? {};
  switch (buildingId) {
    case 'habitat_dome':
      return rules.muster_threshold != null;
    case 'storm_shelter':
      return rules.storm_threshold != null;
    case 'vault_conduit':
      return !!rules.vault && ctx.regionId === rules.vault.region_id;
    case 'toll_beacon':
      return (ctx.lanePartners?.length ?? 0) > 0;
  }
}

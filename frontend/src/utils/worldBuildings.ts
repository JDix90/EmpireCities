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
 *   Toll Beacon    a gateway (the server stamps `lane_partners` on each).
 *
 * A lane carries one Toll Beacon and a Vault one Vault Conduit; when what a
 * building taxes already carries one, the panel says so rather than hiding it.
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

export interface WorldBuildingTakenContext extends WorldBuildingContext {
  /** This system's id, so its own buildings are not counted against it. */
  territoryId?: string;
  /** Every system of the map, with its world and region. */
  mapTerritories: ReadonlyArray<{ territory_id: string; region_id: string; world_id?: string }>;
  /** The live territories, for the buildings already standing. */
  territories: Record<string, { buildings?: string[] } | undefined>;
}

/**
 * The world buildings this system cannot take because the lane or Vault they
 * tax already carries one elsewhere, each with the reason the server gives.
 */
export function worldBuildingsTaken(ctx: WorldBuildingTakenContext): Record<string, string> {
  const carries = (id: string, building: string): boolean =>
    (ctx.territories[id]?.buildings ?? []).includes(building);
  const out: Record<string, string> = {};
  if ((ctx.lanePartners ?? []).some((p) => carries(p, 'toll_beacon'))) {
    out.toll_beacon = 'This lane already carries a Toll Beacon at its other end.';
  }
  const vault = ctx.worldId ? ctx.worldRules?.[ctx.worldId]?.vault : undefined;
  if (vault && ctx.regionId === vault.region_id && ctx.mapTerritories.some((t) =>
    t.territory_id !== ctx.territoryId && t.world_id === ctx.worldId && t.region_id === vault.region_id
      && carries(t.territory_id, 'vault_conduit'))) {
    out.vault_conduit = 'This Vault already carries a Vault Conduit.';
  }
  return out;
}

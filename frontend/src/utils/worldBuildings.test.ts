/**
 * The build panel offers a Galactic Age world building only on a system where
 * the server would let it stand (backend state/worldBuildings.ts).
 */
import { describe, it, expect } from 'vitest';
import type { WorldRules } from '@borderfall/shared';
import { worldBuildingApplies, worldBuildingsTaken } from './worldBuildings';

const RULES: Record<string, WorldRules> = {
  sol: { muster_threshold: 2, muster_every: 5 },
  verdan: { storm_threshold: 12, storm_attrition: 1 },
  rust: { defense_building_bonus_dice: 1 },
  nexus_station: { vault: { region_id: 'nexus_gate_ring', neutral_garrison: 6, tech_income: 2 } },
};

describe('worldBuildingApplies', () => {
  it('a Habitat Dome on the Cradle world, a Storm Shelter on the storm world', () => {
    expect(worldBuildingApplies('habitat_dome', { worldId: 'sol', worldRules: RULES })).toBe(true);
    expect(worldBuildingApplies('habitat_dome', { worldId: 'verdan', worldRules: RULES })).toBe(false);
    expect(worldBuildingApplies('storm_shelter', { worldId: 'verdan', worldRules: RULES })).toBe(true);
    expect(worldBuildingApplies('storm_shelter', { worldId: 'rust', worldRules: RULES })).toBe(false);
  });

  it('a Vault Conduit on a Vault system only, not anywhere on its world', () => {
    expect(worldBuildingApplies('vault_conduit', { worldId: 'nexus_station', regionId: 'nexus_gate_ring', worldRules: RULES })).toBe(true);
    expect(worldBuildingApplies('vault_conduit', { worldId: 'nexus_station', regionId: 'nexus_berth_ring', worldRules: RULES })).toBe(false);
  });

  it('a Toll Beacon on a stamped gateway only', () => {
    expect(worldBuildingApplies('toll_beacon', { lanePartners: ['verdan_chlorophage_span'] })).toBe(true);
    expect(worldBuildingApplies('toll_beacon', {})).toBe(false);
  });

  it('nothing without the world rules, and every other building untouched', () => {
    expect(worldBuildingApplies('habitat_dome', { worldId: 'sol' })).toBe(false);
    expect(worldBuildingApplies('jump_gate', {})).toBe(true);
    expect(worldBuildingApplies('production_1', {})).toBe(true);
  });
});

describe('worldBuildingsTaken', () => {
  const MAP = [
    { territory_id: 'ring_a', region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
    { territory_id: 'ring_b', region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
    { territory_id: 'berth', region_id: 'nexus_berth_ring', world_id: 'nexus_station' },
    { territory_id: 'sol_gate', region_id: 'sol_africa', world_id: 'sol' },
    { territory_id: 'verdan_gate', region_id: 'verdan_span', world_id: 'verdan' },
  ];
  const vaultCtx = { worldId: 'nexus_station', regionId: 'nexus_gate_ring', worldRules: RULES, mapTerritories: MAP };

  it('a Vault carries one Vault Conduit, on any of its systems', () => {
    expect(worldBuildingsTaken({ ...vaultCtx, territoryId: 'ring_a', territories: {} })).toEqual({});
    const territories = { ring_b: { buildings: ['vault_conduit'] } };
    expect(worldBuildingsTaken({ ...vaultCtx, territoryId: 'ring_a', territories }).vault_conduit).toMatch(/already carries a Vault Conduit/);
    // Its own Conduit is the one-per-system slot, not a reason.
    expect(worldBuildingsTaken({ ...vaultCtx, territoryId: 'ring_b', territories })).toEqual({});
    // Another region of the same world is not the Vault.
    expect(worldBuildingsTaken({ ...vaultCtx, regionId: 'nexus_berth_ring', territoryId: 'berth', territories })).toEqual({});
  });

  it('a lane carries one Toll Beacon, at either end', () => {
    const territories = { verdan_gate: { buildings: ['toll_beacon'] } };
    expect(worldBuildingsTaken({
      worldId: 'sol', regionId: 'sol_africa', lanePartners: ['verdan_gate'], worldRules: RULES,
      territoryId: 'sol_gate', mapTerritories: MAP, territories,
    })).toEqual({ toll_beacon: 'This lane already carries a Toll Beacon at its other end.' });
  });
});

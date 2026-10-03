/**
 * The build panel offers a Galactic Age world building only on a system where
 * the server would let it stand (backend state/worldBuildings.ts).
 */
import { describe, it, expect } from 'vitest';
import type { WorldRules } from '@borderfall/shared';
import { worldBuildingApplies } from './worldBuildings';

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

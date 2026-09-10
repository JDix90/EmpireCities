/**
 * Galactic Age — worlds as characters.
 *
 * One rule per world, authored on `map.worlds[].rules`, snapshotted into
 * `settings.world_rules` at init and gated by `world_rules_enabled`:
 *   Sol III      deploy cap +2 per tile, population grows twice as fast
 *   Verdan Reach any tile above 12 units sheds one to the storms each round
 *   Rust Belt    buildings cost half (a modifier); a defended tile rolls +1 die
 *   Nexus        the Gate Ring starts neutral (garrison 6); its holder earns
 *                +2 tech per turn and an Emergency Seal on ANY lane
 *
 * The Custodians briefly started with +1 unit per tile (`vault.home_unit_bonus`)
 * to pay for the ring they begin without. It came out again once Lane Sovereignty
 * and the Jump Gates landed: measured at 400 games x 3 seeds it was worth about
 * seven points of win rate (Nexus 34% with it, 27% without) on a seat that no
 * longer needed the help. The field is still supported for other maps.
 *
 * The numeric world modifiers stay alongside the rules: measured with them cut
 * (200g, seed A) the Custodians fell to 0.5% and Forge to 9.5%, because the
 * modifiers were load-bearing for the era's economy. The rules ADD character;
 * they do not replace income. Nexus keeps its region bonuses for the same
 * reason — a home that pays nothing is a 12-tile handicap, not a prize.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { normalizeGameSettings } from './gameSettings';
import { collectProduction, getBuildingDefenseBonus } from './economyManager';
import { getDeployCap } from './stabilityManager';
import { canSealLane, EMERGENCY_SEAL_ABILITY_ID } from './moonAccess';
import {
  applyStormAttrition,
  buildWorldRuleSnapshot,
  getWorldRules,
  playerHoldsVaultSeal,
  vaultRegionGarrisons,
  vaultStatuses,
  vaultTechIncome,
  worldDefenseBuildingBonusDice,
  worldDeployCapBonus,
  worldPopulationGrowthMult,
} from './worldRules';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;
const RING = 'nexus_gate_ring';

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function freshGalaxyState(overrides: Partial<GameSettings> = {}): GameState {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = SEAT.map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
  }));
  return initializeGameState('t_rules', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
}

const ringTiles = (state: GameState) =>
  Object.values(state.territories).filter((t) => t.world_id === 'nexus_station' && t.region_id === RING);

describe('world rules snapshot', () => {
  it('collects every authored rule from the galaxy map, and nothing when disabled', () => {
    const snap = buildWorldRuleSnapshot(AUTHORED, true)!;
    expect(Object.keys(snap).sort()).toEqual(['nexus_station', 'rust', 'sol', 'verdan']);
    expect(snap.sol).toEqual({ deploy_cap_bonus: 2, population_growth_mult: 2 });
    expect(snap.verdan).toEqual({ storm_threshold: 12, storm_attrition: 1 });
    expect(snap.rust).toEqual({ defense_building_bonus_dice: 1 });
    expect(snap.nexus_station.vault).toEqual({
      region_id: RING, neutral_garrison: 6, tech_income: 2, emergency_seal: true,
    });
    expect(buildWorldRuleSnapshot(AUTHORED, false)).toBeUndefined();
    expect(buildWorldRuleSnapshot({ worlds: [{ world_id: 'a' }, { world_id: 'b', rules: {} }] }, true)).toBeUndefined();
  });

  it('survives re-normalization, and the kill switch is persisted only when off', () => {
    const snap = buildWorldRuleSnapshot(AUTHORED, true);
    const first = normalizeGameSettings({ world_rules: snap });
    expect(first.world_rules).toEqual(snap);
    expect(first.world_rules_enabled).toBeUndefined();
    expect(normalizeGameSettings(first).world_rules).toEqual(snap);
    const off = normalizeGameSettings({ world_rules_enabled: false, world_rules: snap });
    expect(off.world_rules_enabled).toBe(false);
    expect(off.world_rules).toBeUndefined();
  });

  it('lands on settings at init, and the flag turns it all off', () => {
    const on = freshGalaxyState();
    expect(on.settings.world_rules?.sol?.deploy_cap_bonus).toBe(2);
    expect(getWorldRules(on, 'verdan').storm_threshold).toBe(12);
    expect(getWorldRules(on, 'nowhere')).toEqual({});
    const off = freshGalaxyState({ world_rules_enabled: false });
    expect(off.settings.world_rules).toBeUndefined();
    expect(getWorldRules(off, 'sol')).toEqual({});
  });
});

describe('Sol III · the Cradle', () => {
  it('raises the stability deploy cap by the world bonus', () => {
    const state = freshGalaxyState();
    expect(worldDeployCapBonus(state, 'sol')).toBe(2);
    expect(worldDeployCapBonus(state, 'rust')).toBe(0);
    const base = getDeployCap(20, { era: 'galaxy_age', turnNumber: 1 });
    expect(getDeployCap(20, { era: 'galaxy_age', turnNumber: 1, worldDeployCapBonus: 2 })).toBe(base + 2);
    // No cap at healthy stability, bonus or not.
    expect(getDeployCap(60, { era: 'galaxy_age', worldDeployCapBonus: 2 })).toBe(Infinity);
  });

  it('doubles the population growth chance on Sol only', () => {
    const state = freshGalaxyState();
    expect(worldPopulationGrowthMult(state, 'sol')).toBe(2);
    expect(worldPopulationGrowthMult(state, 'verdan')).toBe(1);
    expect(worldPopulationGrowthMult(state, undefined)).toBe(1);
  });
});

describe('Verdan Reach · the Storms', () => {
  it('sheds one unit from every Verdan tile above 12 at round start, never below 12', () => {
    const state = freshGalaxyState();
    const verdan = Object.values(state.territories).filter((t) => t.world_id === 'verdan');
    const sol = Object.values(state.territories).find((t) => t.world_id === 'sol')!;
    verdan[0].unit_count = 15;
    verdan[1].unit_count = 13;
    verdan[2].unit_count = 12;
    sol.unit_count = 30;
    const losses = applyStormAttrition(state);
    expect(losses.map((l) => l.territory_id).sort()).toEqual([verdan[0].territory_id, verdan[1].territory_id].sort());
    expect(verdan[0].unit_count).toBe(14);
    expect(verdan[1].unit_count).toBe(12);
    expect(verdan[2].unit_count).toBe(12);
    expect(sol.unit_count).toBe(30);
    // Neutral tiles weather it too; nothing happens with the rules off.
    verdan[0].owner_id = null;
    verdan[0].unit_count = 20;
    expect(applyStormAttrition(state)).toHaveLength(1);
    expect(verdan[0].unit_count).toBe(19);
    const off = freshGalaxyState({ world_rules_enabled: false });
    Object.values(off.territories).find((t) => t.world_id === 'verdan')!.unit_count = 40;
    expect(applyStormAttrition(off)).toEqual([]);
  });
});

describe('Rust Belt · the Forge', () => {
  it('adds a defence die to a Rust tile that has a defence building, and only then', () => {
    const state = freshGalaxyState();
    const rust = Object.values(state.territories).find((t) => t.world_id === 'rust')!;
    const sol = Object.values(state.territories).find((t) => t.world_id === 'sol')!;
    expect(worldDefenseBuildingBonusDice(state, 'rust')).toBe(1);
    expect(getBuildingDefenseBonus(state, rust.territory_id)).toBe(0);
    rust.buildings = ['defense_1'];
    sol.buildings = ['defense_1'];
    expect(getBuildingDefenseBonus(state, rust.territory_id)).toBe(getBuildingDefenseBonus(state, sol.territory_id) + 1);
  });

  it('halves building costs through the world modifier', () => {
    const state = freshGalaxyState();
    expect(state.settings.world_modifiers?.rust?.build_cost_mult).toBe(0.5);
  });
});

describe('Nexus Station · the Vault', () => {
  it('starts the Gate Ring neutral with a garrison of 6; the Custodians hold the other twelve', () => {
    const state = freshGalaxyState();
    const ring = ringTiles(state);
    expect(ring).toHaveLength(4);
    for (const t of ring) {
      expect(t.owner_id).toBeNull();
      expect(t.unit_count).toBe(6);
    }
    const custodian = Object.values(state.territories).filter((t) => t.owner_id === 'p_nexus');
    expect(custodian).toHaveLength(12);
    expect(custodian.every((t) => t.world_id === 'nexus_station')).toBe(true);
    // No home bonus on the shipped map: they hold twelve tiles at the same
    // starting count as everyone else, and must take the ring like everyone else.
    expect(custodian.every((t) => t.unit_count === 3)).toBe(true);
    expect(Object.values(state.territories).filter((t) => t.owner_id === 'p_sol').every((t) => t.unit_count === 3)).toBe(true);
    // The other three homeworlds are whole.
    for (const seat of ['p_sol', 'p_rust', 'p_verdan']) {
      expect(Object.values(state.territories).filter((t) => t.owner_id === seat)).toHaveLength(16);
    }
    expect([...vaultRegionGarrisons(AUTHORED).values()]).toEqual([6, 6, 6, 6]);
  });

  it('is a homeworld again with the rules off, at the plain starting count', () => {
    const state = freshGalaxyState({ world_rules_enabled: false });
    const custodian = Object.values(state.territories).filter((t) => t.owner_id === 'p_nexus');
    expect(custodian).toHaveLength(16);
    expect(custodian.every((t) => t.unit_count === 3)).toBe(true);
  });

  it('is held only by the player with every ring tile, and pays them +2 tech per turn', () => {
    const state = freshGalaxyState();
    expect(vaultStatuses(state)).toEqual([
      { world_id: 'nexus_station', region_id: RING, holder_id: null, tech_income: 2, emergency_seal: true, tiles: 4 },
    ]);
    const before = collectProduction(state, 'p_sol').techPointsEarned;
    const ring = ringTiles(state);
    for (const t of ring.slice(0, 3)) t.owner_id = 'p_sol';
    expect(vaultStatuses(state)[0].holder_id).toBeNull();
    expect(vaultTechIncome(state, 'p_sol')).toBe(0);
    ring[3].owner_id = 'p_sol';
    expect(vaultStatuses(state)[0].holder_id).toBe('p_sol');
    expect(vaultTechIncome(state, 'p_sol')).toBe(2);
    expect(vaultTechIncome(state, 'p_nexus')).toBe(0);
    // Base tech is 1 per 5 tiles: 16 → 3, 20 → 4; the Vault adds 2 on top.
    const after = collectProduction(state, 'p_sol').techPointsEarned;
    expect(after - before).toBe(Math.floor(20 / 5) - Math.floor(16 / 5) + 2);
  });

  it('lets its holder fire an Emergency Seal on ANY lane; the Custodians alone stay Nexus-bound', () => {
    const state = freshGalaxyState();
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const solVerdan = ['sol_guinea', 'verdan_chlorophage_span'] as const;
    expect(playerHoldsVaultSeal(state, 'p_sol')).toBe(false);
    expect(canSealLane(state, map, solVerdan[0], solVerdan[1], 'p_sol', undefined).ok).toBe(false);
    expect(canSealLane(state, map, solVerdan[0], solVerdan[1], 'p_nexus', EMERGENCY_SEAL_ABILITY_ID).error)
      .toMatch(/touch Nexus Station/);
    for (const t of ringTiles(state)) t.owner_id = 'p_sol';
    expect(playerHoldsVaultSeal(state, 'p_sol')).toBe(true);
    const viaVault = canSealLane(state, map, solVerdan[0], solVerdan[1], 'p_sol', undefined, {
      vaultHolder: playerHoldsVaultSeal(state, 'p_sol'),
    });
    expect(viaVault.ok).toBe(true);
    // Still a hyperspace lane or nothing.
    expect(canSealLane(state, map, 'sol_guinea', 'sol_atlantic_europe', 'p_sol', undefined, { vaultHolder: true }).ok).toBe(false);
  });
});

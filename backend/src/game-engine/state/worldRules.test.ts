/**
 * Galactic Age — worlds as characters.
 *
 * One rule per world, authored on `map.worlds[].rules`, snapshotted into
 * `settings.world_rules` at init and gated by `world_rules_enabled`:
 *   Sol III      deploy cap +2 per tile, population grows twice as fast
 *   Verdan Reach any tile above 12 units sheds one to the storms each round
 *   Rust Belt    buildings cost half (a modifier); a defended tile rolls +1 die
 *   Nexus        the Gate Ring starts neutral (garrison 6); its holder earns
 *                +2 tech per turn and an Emergency Seal on ANY lane. The neutral
 *                ring and the Custodians' home bonus are the starting layout and
 *                hold even with `world_rules_enabled` off; only the Vault's
 *                payouts are gated.
 *
 * The Custodians briefly started with +1 unit per tile (`vault.home_unit_bonus`)
 * to pay for the ring they begin without. It came out once Lane Sovereignty and
 * the Jump Gates landed (Nexus 34% with it, 27% without, 400 games x 3 seeds),
 * and went back in with the Shattered Shell: the rebuilt world is a hub whose
 * Vault sits at the centre with every inner shard bridging into it, and without
 * the bonus the Custodians measured 8% (1,000 games x 3 seeds). See the note in
 * eras/galaxyage.ts for the tech modifier that went back with it.
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
  WORLD_RULE_FIELDS,
  WORLD_RULE_IDS,
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
      region_id: RING, neutral_garrison: 6, tech_income: 2, emergency_seal: true, home_unit_bonus: 1,
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

describe('one switch per rule', () => {
  it('covers every authored rule field exactly once', () => {
    const owned = WORLD_RULE_IDS.flatMap((id) => WORLD_RULE_FIELDS[id]);
    expect(new Set(owned).size).toBe(owned.length);
    const authored = Object.values(buildWorldRuleSnapshot(AUTHORED, true)!).flatMap((r) => Object.keys(r));
    expect(authored.every((f) => (owned as string[]).includes(f))).toBe(true);
  });

  it('drops only the switched-off rule from the snapshot', () => {
    const noStorms = buildWorldRuleSnapshot(AUTHORED, true, ['storms'])!;
    expect(noStorms.verdan).toBeUndefined();
    expect(noStorms.sol).toEqual({ deploy_cap_bonus: 2, population_growth_mult: 2 });
    expect(noStorms.nexus_station.vault?.tech_income).toBe(2);
    const noneLeft = buildWorldRuleSnapshot(AUTHORED, true, [...WORLD_RULE_IDS]);
    expect(noneLeft).toBeUndefined();
  });

  it('keeps known ids only, in a fixed order, and persists nothing when none are off', () => {
    expect(normalizeGameSettings({}).world_rules_disabled).toBeUndefined();
    expect(normalizeGameSettings({ world_rules_disabled: [] }).world_rules_disabled).toBeUndefined();
    const raw = { world_rules_disabled: ['vault', 'bogus', 'storms', 'vault'] } as unknown as Partial<GameSettings>;
    expect(normalizeGameSettings(raw).world_rules_disabled).toEqual(['storms', 'vault']);
  });

  it('switching the Cradle off at create leaves the Storms and the Vault working', () => {
    const state = freshGalaxyState({ world_rules_disabled: ['cradle'] });
    expect(worldDeployCapBonus(state, 'sol')).toBe(0);
    expect(worldPopulationGrowthMult(state, 'sol')).toBe(1);
    expect(getWorldRules(state, 'verdan').storm_threshold).toBe(12);
    expect(vaultStatuses(state)).toHaveLength(1);
  });

  it('switching the Vault off stops its payouts but keeps the ring neutral at start', () => {
    const state = freshGalaxyState({ world_rules_disabled: ['vault'] });
    expect(vaultStatuses(state)).toEqual([]);
    for (const t of ringTiles(state)) {
      expect(t.owner_id).toBeNull();
      expect(t.unit_count).toBe(6);
    }
    for (const t of ringTiles(state)) t.owner_id = 'p_sol';
    expect(vaultTechIncome(state, 'p_sol')).toBe(0);
    expect(playerHoldsVaultSeal(state, 'p_sol')).toBe(false);
    expect(getWorldRules(state, 'verdan').storm_threshold).toBe(12);
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
  it('starts the Gate Ring neutral with a garrison of 6; the Custodians hold the other twelve, +1 each', () => {
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
    // The Vault's home bonus pays for the ring they begin without: one extra
    // unit on each of their twelve tiles. Everyone else starts at the plain count.
    expect(custodian.every((t) => t.unit_count === 4)).toBe(true);
    expect(Object.values(state.territories).filter((t) => t.owner_id === 'p_sol').every((t) => t.unit_count === 3)).toBe(true);
    // The other three homeworlds are whole.
    for (const seat of ['p_sol', 'p_rust', 'p_verdan']) {
      expect(Object.values(state.territories).filter((t) => t.owner_id === seat)).toHaveLength(16);
    }
    expect([...vaultRegionGarrisons(AUTHORED).values()]).toEqual([6, 6, 6, 6]);
  });

  it('keeps the same start with the rules off: the kill switch turns off what the Vault does, not the board', () => {
    // With the rules off the Custodians used to start owning the ring too, and
    // won ~41% of simulated games against an 18–32% gate. The ring's neutral
    // garrison and the home bonus that pays for it are the starting layout, so
    // they hold; the Vault's tech income and Emergency Seal are rules, so they go.
    const state = freshGalaxyState({ world_rules_enabled: false });
    expect(state.settings.world_rules).toBeUndefined();
    for (const t of ringTiles(state)) {
      expect(t.owner_id).toBeNull();
      expect(t.unit_count).toBe(6);
    }
    const custodian = Object.values(state.territories).filter((t) => t.owner_id === 'p_nexus');
    expect(custodian).toHaveLength(12);
    expect(custodian.every((t) => t.unit_count === 4)).toBe(true);
    expect(vaultStatuses(state)).toEqual([]);
    for (const t of ringTiles(state)) t.owner_id = 'p_sol';
    expect(vaultTechIncome(state, 'p_sol')).toBe(0);
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

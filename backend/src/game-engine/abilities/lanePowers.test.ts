/**
 * Galactic Age lane powers (docs/GALACTIC_AGE_BUILDINGS.md §6): Lance Battery,
 * Orbital Muster, Seal Breaker and Surge Projector. Opened by galaxy techs only under
 * `galaxy_powers`, fired from a tile carrying the building each needs, priced
 * in PP charged after the effect succeeds. A game without the setting is
 * today's game: no node unlocks them and the engine refuses them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GALAXY_LANE_POWER_COSTS } from '@borderfall/shared';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from '../state/gameStateManager';
import { normalizeGameSettings } from '../state/gameSettings';
import { eraTechTreeOptions, getEraTechTree } from '../eras';
import { GALAXY_AGE_TECH_TREE, GALAXY_AGE_TECH_TREE_V2, GALAXY_POWER_UNLOCKS, galaxyAgeTechTree } from '../eras/galaxyage';
import { getUnlockedAbilityIds } from './techAbilities';
import { executeTechAbility } from './executeTechAbility';
import {
  LANE_POWER_TUNING,
  checkLanePowerRequirement,
  consumeSealBreaker,
  lanePowerSources,
} from './lanePowers';
import {
  aiFiresLanePowers,
  aiLanePowerReserve,
  canAiFireLanePower,
  selectAiLanceBatteryTarget,
  selectAiOrbitalMusterTarget,
  selectAiSealBreaker,
  selectAiSurgeProjector,
} from '../ai/aiLanePowers';
import { advanceToNextPlayer } from '../state/gameStateManager';
import { ringGapLanes } from '../state/galaxyRing';
import {
  isSurgeProjectorLaneLive,
  SURGE_PROJECTOR_LANE_SOURCE,
  surgeProjectorCarries,
  syncSurgeProjectorLanes,
} from '../state/surgeProjector';
import { crossableLanes } from './lanePowers';
import { selectAiGarrisonDoctrines } from '../ai/aiBot';
import { orbitLaneId } from '../state/moonAccess';

const GALAXY = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

/** A Sol gateway and the Verdan gateway at the other end of its lane; an inland Sol tile. */
const SOL_GATE = 'sol_guinea';
const VERDAN_GATE = 'verdan_chlorophage_span';
const SOL_INLAND = 'sol_columbia';

const FOUR = ['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians'];
const SOL = 'p_stellar_mandate';
const VERDAN = 'p_helion_navigators';

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true, world_rules_enabled: false,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    galaxy_powers: true,
    ...overrides,
  } as unknown as GameSettings;
}

function galaxyGame(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(GALAXY)) as GameMap;
  const players = FOUR.map((faction_id, i) => ({
    player_id: `p_${faction_id}`, player_index: i, username: faction_id, color: '#fff',
    is_ai: true, is_eliminated: false, mmr: 1000, faction_id,
  }));
  const state = initializeGameState('t_powers', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  for (const p of state.players) {
    p.special_resource = 30;
    p.unlocked_techs = ['ga_disruption_net', 'ga_battle_fabricators', 'ga_gravity_brake'];
  }
  // Sol holds its gateway with a shield and a fabricator; Verdan holds the far end.
  state.territories[SOL_GATE].owner_id = SOL;
  state.territories[SOL_GATE].unit_count = 8;
  state.territories[SOL_GATE].buildings = ['defense_1', 'production_1'];
  state.territories[VERDAN_GATE].owner_id = VERDAN;
  state.territories[VERDAN_GATE].unit_count = 5;
  state.territories[SOL_INLAND].owner_id = SOL;
  state.territories[SOL_INLAND].buildings = [];
  return { state, map };
}

const purse = (state: GameState, id: string): number => state.players.find((p) => p.player_id === id)!.special_resource ?? 0;

afterEach(() => {
  LANE_POWER_TUNING.lance_battery = GALAXY_LANE_POWER_COSTS.lance_battery;
  LANE_POWER_TUNING.orbital_muster = GALAXY_LANE_POWER_COSTS.orbital_muster;
  LANE_POWER_TUNING.seal_breaker = GALAXY_LANE_POWER_COSTS.seal_breaker;
  LANE_POWER_TUNING.surge_projector = GALAXY_LANE_POWER_COSTS.surge_projector;
});

describe('the tree', () => {
  it('opens no ability without the setting, four with it, on the nodes the doc names', () => {
    expect(GALAXY_AGE_TECH_TREE.some((n) => n.unlocks_ability)).toBe(false);
    const powered = galaxyAgeTechTree({ powers: true });
    const opened = Object.fromEntries(powered.filter((n) => n.unlocks_ability).map((n) => [n.tech_id, n.unlocks_ability]));
    expect(opened).toEqual(GALAXY_POWER_UNLOCKS);
    expect(opened).toEqual({
      ga_disruption_net: 'lance_battery',
      ga_battle_fabricators: 'orbital_muster',
      ga_gravity_brake: 'seal_breaker',
      ga_gate_engineering: 'surge_projector',
    });
    // Costs, tiers and prerequisites do not move.
    for (const [i, n] of powered.entries()) {
      expect([n.tech_id, n.cost, n.tier, n.prerequisite]).toEqual([
        GALAXY_AGE_TECH_TREE[i].tech_id, GALAXY_AGE_TECH_TREE[i].cost, GALAXY_AGE_TECH_TREE[i].tier, GALAXY_AGE_TECH_TREE[i].prerequisite,
      ]);
    }
  });

  it('combines with buildings v2, and every combination is built once', () => {
    const both = galaxyAgeTechTree({ buildingsV2: true, powers: true });
    expect(both.find((n) => n.tech_id === 'ga_disruption_net')).toMatchObject({ unlocks_ability: 'lance_battery', unlocks_buildings: ['defense_2'] });
    expect(galaxyAgeTechTree({ buildingsV2: true, powers: true })).toBe(both);
    expect(galaxyAgeTechTree({ buildingsV2: true })).toBe(GALAXY_AGE_TECH_TREE_V2);
    expect(galaxyAgeTechTree({})).toBe(GALAXY_AGE_TECH_TREE);
  });

  it('is selected per game from its settings', () => {
    expect(eraTechTreeOptions({ galaxy_powers: true })).toEqual({ galaxyBuildingsV2: false, galaxyPowers: true });
    expect(getEraTechTree('galaxy_age', { galaxyPowers: true })).toBe(galaxyAgeTechTree({ powers: true }));
    expect(getEraTechTree('space_age', { galaxyPowers: true })).toBe(getEraTechTree('space_age'));
  });

  it('a player holds the powers their research opened only in a game with the setting', () => {
    const on = galaxyGame();
    expect([...getUnlockedAbilityIds(on.state, on.state.players[0])].sort()).toEqual(['lance_battery', 'orbital_muster', 'seal_breaker']);
    const off = galaxyGame({ galaxy_powers: undefined });
    expect([...getUnlockedAbilityIds(off.state, off.state.players[0])]).toEqual([]);
  });
});

describe('Lance Battery', () => {
  it('takes 2 units off the gateway across the lane and charges 5 PP', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE });
    expect(res.success, res.error).toBe(true);
    expect(res.productionSpent).toBe(5);
    expect(state.territories[VERDAN_GATE].unit_count).toBe(3);
    expect(purse(state, SOL)).toBe(25);
  });

  it('floors at 1 unit', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    state.territories[VERDAN_GATE].unit_count = 2;
    executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE });
    expect(state.territories[VERDAN_GATE].unit_count).toBe(1);
  });

  it('needs a defence building on your gateway across an OPEN lane, and charges nothing when refused', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    state.territories[SOL_GATE].buildings = ['production_1'];
    const noShield = executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE });
    expect(noShield.success).toBe(false);
    expect(noShield.error).toMatch(/defence building on your gateway/);
    expect(purse(state, SOL)).toBe(30);

    state.territories[SOL_GATE].buildings = ['defense_1'];
    state.lane_blockades = { [orbitLaneId(SOL_GATE, VERDAN_GATE)]: { owner_id: VERDAN, turns_remaining: 1, tick: 'owner_turn' } };
    expect(lanePowerSources(state, map, SOL, 'lance_battery', VERDAN_GATE)).toEqual([]);
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE }).success).toBe(false);
  });

  it('fires only on a rival, never inland, never in the draft', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    expect(checkLanePowerRequirement(state, map, SOL, 'lance_battery', SOL_INLAND)).toMatch(/rival's gateway/);
    // A rival's inland tile has no lane to fire across.
    state.territories[SOL_INLAND].owner_id = VERDAN;
    expect(checkLanePowerRequirement(state, map, SOL, 'lance_battery', SOL_INLAND)).toMatch(/defence building on your gateway/);
    state.phase = 'draft';
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE }).error).toMatch(/attack phase/);
  });
});

describe('Orbital Muster', () => {
  it('places 3 units on a gateway with an industry building and charges 6 PP', () => {
    const { state, map } = galaxyGame();
    state.phase = 'draft';
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'orbital_muster', territoryId: SOL_GATE });
    expect(res.success, res.error).toBe(true);
    expect(state.territories[SOL_GATE].unit_count).toBe(11);
    expect(purse(state, SOL)).toBe(24);
  });

  it('refuses an inland tile even with an industry building, a gateway without one, and a short purse, charging nothing', () => {
    const { state, map } = galaxyGame();
    state.phase = 'draft';
    state.territories[SOL_INLAND].buildings = ['production_1'];
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'orbital_muster', territoryId: SOL_INLAND }).error)
      .toMatch(/fires from a gateway/);
    state.territories[SOL_GATE].buildings = ['defense_1'];
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'orbital_muster', territoryId: SOL_GATE }).error)
      .toMatch(/industry building/);
    state.territories[SOL_GATE].buildings = ['defense_1', 'production_1'];
    expect(purse(state, SOL)).toBe(30);
    state.players[0].special_resource = 5;
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'orbital_muster', territoryId: SOL_GATE }).error)
      .toMatch(/costs 6 PP \(you have 5\)/);
    expect(state.territories[SOL_GATE].unit_count).toBe(8);
  });
});

describe('Seal Breaker', () => {
  it('arms the gateway it is fired from, for 4 PP; only a crossing from there spends it', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'seal_breaker', territoryId: SOL_GATE });
    expect(res.success, res.error).toBe(true);
    expect(purse(state, SOL)).toBe(26);
    const me = state.players[0];
    expect(me.pending_seal_breaker_from).toBe(SOL_GATE);
    expect(consumeSealBreaker(me, SOL_INLAND)).toBe(false);
    expect(consumeSealBreaker(me, SOL_GATE)).toBe(true);
    expect(me.pending_seal_breaker_from).toBeUndefined();
  });

  it('fires only from a gateway with a defence building', () => {
    const { state, map } = galaxyGame();
    state.phase = 'attack';
    state.territories[SOL_INLAND].buildings = ['defense_1'];
    expect(checkLanePowerRequirement(state, map, SOL, 'seal_breaker', SOL_INLAND)).toMatch(/from a gateway/);
    state.territories[SOL_GATE].buildings = ['production_1'];
    expect(checkLanePowerRequirement(state, map, SOL, 'seal_breaker', SOL_GATE)).toMatch(/defence building/);
  });
});

describe('without the setting', () => {
  it('the engine refuses every lane power, charging nothing', () => {
    const { state, map } = galaxyGame({ galaxy_powers: undefined });
    state.phase = 'attack';
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'lance_battery', territoryId: VERDAN_GATE });
    expect(res.error).toMatch(/not enabled/);
    expect(state.territories[VERDAN_GATE].unit_count).toBe(5);
    expect(purse(state, SOL)).toBe(30);
  });

  it('every other ability resolves exactly as before', () => {
    const { state, map } = galaxyGame({ galaxy_powers: undefined });
    expect(checkLanePowerRequirement(state, map, SOL, 'blockade_runner', undefined)).toBeNull();
  });

  it('normalizes galaxy_powers as present only when on', () => {
    expect(normalizeGameSettings({}).galaxy_powers).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_powers: false }).galaxy_powers).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_powers: true }).galaxy_powers).toBe(true);
  });
});

describe('prices are knobs', () => {
  it('the gate and the charge read the tuning', () => {
    const { state, map } = galaxyGame();
    state.phase = 'draft';
    LANE_POWER_TUNING.orbital_muster = 9;
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'orbital_muster', territoryId: SOL_GATE });
    expect(res.productionSpent).toBe(9);
    expect(purse(state, SOL)).toBe(21);
  });
});

describe('the AI', () => {
  it('fires at medium and above, only what it has unlocked, unused and can afford', () => {
    expect(aiFiresLanePowers('easy')).toBe(false);
    expect(aiFiresLanePowers('tutorial')).toBe(false);
    expect(aiFiresLanePowers('medium')).toBe(true);
    const { state } = galaxyGame();
    expect(canAiFireLanePower(state, SOL, 'lance_battery')).toBe(true);
    state.players[0].ability_uses = { lance_battery: 1 };
    expect(canAiFireLanePower(state, SOL, 'lance_battery')).toBe(false);
    state.players[0].special_resource = 3;
    expect(canAiFireLanePower(state, SOL, 'seal_breaker')).toBe(false);
  });

  it('musters on the industry gateway facing the most units across a lane, never inland', () => {
    const { state, map } = galaxyGame();
    expect(selectAiOrbitalMusterTarget(state, map, SOL)).toBe(SOL_GATE);
    // An inland fabricator facing a land border is not a source.
    state.territories[SOL_GATE].buildings = ['defense_1'];
    state.territories[SOL_INLAND].buildings = ['production_1'];
    expect(selectAiOrbitalMusterTarget(state, map, SOL)).toBeNull();
    state.territories[SOL_GATE].buildings = ['defense_1', 'production_1'];
    state.territories[VERDAN_GATE].owner_id = SOL;
    // No rival across any lane and none by land: nothing to muster against.
    for (const t of Object.values(state.territories)) if (t.owner_id && t.owner_id !== SOL) t.owner_id = null;
    expect(selectAiOrbitalMusterTarget(state, map, SOL)).toBeNull();
  });

  it('fires the battery at a stout far gateway of a planned crossing only', () => {
    const { state, map } = galaxyGame();
    const crossing = [{ type: 'attack' as const, from: SOL_GATE, to: VERDAN_GATE, units: 3 }];
    expect(selectAiLanceBatteryTarget(state, map, SOL, crossing)).toBe(VERDAN_GATE);
    expect(selectAiLanceBatteryTarget(state, map, SOL, [])).toBeNull();
    state.territories[VERDAN_GATE].unit_count = 2;
    expect(selectAiLanceBatteryTarget(state, map, SOL, crossing)).toBeNull();
  });

  it('breaks a seal only when one is on a lane it can win across', () => {
    const { state, map } = galaxyGame();
    expect(selectAiSealBreaker(state, map, SOL)).toBeNull();
    state.lane_blockades = { [orbitLaneId(SOL_GATE, VERDAN_GATE)]: { owner_id: VERDAN, turns_remaining: 1, tick: 'owner_turn' } };
    expect(selectAiSealBreaker(state, map, SOL)).toEqual({ source: SOL_GATE, target: VERDAN_GATE });
    state.territories[VERDAN_GATE].unit_count = 9;
    expect(selectAiSealBreaker(state, map, SOL)).toBeNull();
  });

  it('keeps back the dearest unfired power, and the doctrine picker spends around it', () => {
    const { state, map } = galaxyGame({ galaxy_garrisons: true });
    expect(aiLanePowerReserve(state, SOL)).toBe(6);
    state.players[0].ability_uses = { orbital_muster: 1 };
    expect(aiLanePowerReserve(state, SOL)).toBe(5);
    state.players[0].ability_uses = {};
    state.players[0].unlocked_techs = [...state.players[0].unlocked_techs!, 'ga_lattice_logistics'];
    state.players[0].special_resource = 11;
    // 11 PP less a 6 PP reserve leaves 5: not enough for a 6 PP doctrine.
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'hard', [])).toEqual([]);
    state.players[0].special_resource = 12;
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'hard', []).length).toBe(1);
  });
});

/**
 * The gap the authored ring leaves between Sol and the Rust Belt, from Sol's
 * gateway to the Rust gateway at the other end. Sol holds its end, a Jump Gate
 * on each world (one on a Rust tile it holds), and the Forge holds the far
 * gateway thinly.
 */
const GAP_SOL = 'sol_amazonia';
const GAP_RUST = 'rust_anvil_basin';
const RUST_FOOTHOLD = 'rust_furnace_marches';
const FORGE = 'p_forge_syndicate';

function surgeGame(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const { state, map } = galaxyGame(overrides);
  for (const p of state.players) p.unlocked_techs = [...(p.unlocked_techs ?? []), 'ga_gate_engineering'];
  state.territories[GAP_SOL].owner_id = SOL;
  state.territories[GAP_SOL].unit_count = 7;
  state.territories[GAP_SOL].buildings = ['jump_gate'];
  state.territories[RUST_FOOTHOLD].owner_id = SOL;
  state.territories[RUST_FOOTHOLD].buildings = ['jump_gate'];
  state.territories[GAP_RUST].owner_id = FORGE;
  state.territories[GAP_RUST].unit_count = 2;
  state.current_player_index = 0;
  state.phase = 'attack';
  return { state, map };
}

const surgeEdges = (map: GameMap) => map.connections.filter((c) => c.source === SURGE_PROJECTOR_LANE_SOURCE);

describe('Surge Projector', () => {
  it('fires across the gap the ring leaves between Sol and the Rust Belt', () => {
    const { map } = galaxyGame();
    expect(ringGapLanes(map)).toContainEqual({ from: GAP_SOL < GAP_RUST ? GAP_SOL : GAP_RUST, to: GAP_SOL < GAP_RUST ? GAP_RUST : GAP_SOL });
    expect(map.connections.some((c) => (c.from === GAP_SOL && c.to === GAP_RUST) || (c.from === GAP_RUST && c.to === GAP_SOL))).toBe(false);
  });

  it('opens the gap to the rival gateway for 10 PP, as an orbit lane on the map copy', () => {
    const { state, map } = surgeGame();
    const res = executeTechAbility({ state, map, playerId: SOL, abilityId: 'surge_projector', territoryId: GAP_RUST });
    expect(res.success, res.error).toBe(true);
    expect(res.effect).toBe('surge_projector_opened');
    expect(purse(state, SOL)).toBe(20);
    expect(state.surge_projector_lane).toEqual({ owner_id: SOL, from: GAP_SOL, to: GAP_RUST });
    expect(surgeEdges(map)).toEqual([{ from: GAP_SOL, to: GAP_RUST, type: 'orbit', source: SURGE_PROJECTOR_LANE_SOURCE }]);
    expect(surgeProjectorCarries(state, SOL, GAP_SOL, GAP_RUST)).toBe(true);
    expect(surgeProjectorCarries(state, SOL, GAP_RUST, GAP_SOL)).toBe(false);
    // Nothing else reaches across it: no battery, no muster threat, no gateway.
    expect(crossableLanes(map).some((c) => c.source === SURGE_PROJECTOR_LANE_SOURCE)).toBe(false);
  });

  it('closes when the far gateway falls, when the attack phase ends, and at the turn advance', () => {
    const fire = () => {
      const g = surgeGame();
      expect(executeTechAbility({ state: g.state, map: g.map, playerId: SOL, abilityId: 'surge_projector', territoryId: GAP_RUST }).success).toBe(true);
      return g;
    };
    // The crossing that takes the gateway is the one crossing.
    let { state, map } = fire();
    state.territories[GAP_RUST].owner_id = SOL;
    expect(isSurgeProjectorLaneLive(state)).toBe(false);
    expect(syncSurgeProjectorLanes(map, state)).toBe(true);
    expect(surgeEdges(map)).toEqual([]);
    expect(state.surge_projector_lane).toBeUndefined();
    // Fortify cannot use it.
    ({ state, map } = fire());
    state.phase = 'fortify';
    expect(syncSurgeProjectorLanes(map, state)).toBe(true);
    expect(surgeEdges(map)).toEqual([]);
    // The next seat never sees it.
    ({ state, map } = fire());
    advanceToNextPlayer(state, map);
    expect(state.surge_projector_lane).toBeUndefined();
    expect(syncSurgeProjectorLanes(map, state)).toBe(true);
    expect(surgeEdges(map)).toEqual([]);
    // With nothing open, a sync is a no-op that leaves the array alone.
    const before = map.connections;
    expect(syncSurgeProjectorLanes(map, state)).toBe(false);
    expect(map.connections).toBe(before);
  });

  it('needs both Jump Gates, the near gateway, a gap, a rival and the price, charging nothing on refusal', () => {
    const use = (state: GameState, map: GameMap, target: string) =>
      executeTechAbility({ state, map, playerId: SOL, abilityId: 'surge_projector', territoryId: target }).error;
    let { state, map } = surgeGame();
    state.territories[RUST_FOOTHOLD].buildings = [];
    expect(use(state, map, GAP_RUST)).toMatch(/Jump Gates on both worlds/);
    ({ state, map } = surgeGame());
    state.territories[GAP_SOL].owner_id = FORGE;
    expect(use(state, map, GAP_RUST)).toMatch(/your gateway at the other end of the gap/);
    ({ state, map } = surgeGame());
    state.territories.rust_crucible_deep.owner_id = FORGE;
    expect(use(state, map, 'rust_crucible_deep')).toMatch(/only across a gap in the ring/);
    expect(use(state, map, GAP_SOL)).toMatch(/rival's gateway/);
    ({ state, map } = surgeGame());
    map.connections = [...map.connections, { from: GAP_SOL, to: GAP_RUST, type: 'orbit', source: 'lane_surge' }];
    expect(use(state, map, GAP_RUST)).toMatch(/already open/);
    ({ state, map } = surgeGame());
    state.players[0].special_resource = 9;
    expect(use(state, map, GAP_RUST)).toMatch(/costs 10 PP \(you have 9\)/);
    state.phase = 'draft';
    state.players[0].special_resource = 30;
    expect(use(state, map, GAP_RUST)).toMatch(/attack phase/);
    expect(purse(state, SOL)).toBe(30);
    expect(state.surge_projector_lane).toBeUndefined();
    expect(surgeEdges(map)).toEqual([]);
  });

  it('is refused in a game without the setting', () => {
    const { state, map } = surgeGame({ galaxy_powers: undefined });
    expect(executeTechAbility({ state, map, playerId: SOL, abilityId: 'surge_projector', territoryId: GAP_RUST }).success).toBe(false);
    expect(surgeEdges(map)).toEqual([]);
  });

  it('bots open a gap only into a weakly held gateway', () => {
    const { state, map } = surgeGame();
    expect(selectAiSurgeProjector(state, map, SOL)).toEqual({ source: GAP_SOL, target: GAP_RUST });
    state.territories[GAP_RUST].unit_count = 5;
    expect(selectAiSurgeProjector(state, map, SOL)).toBeNull();
    state.territories[GAP_RUST].unit_count = 2;
    state.territories[RUST_FOOTHOLD].buildings = [];
    expect(selectAiSurgeProjector(state, map, SOL)).toBeNull();
  });
});

/**
 * Garrison doctrines (docs/GALACTIC_AGE_BUILDINGS.md §5): Hardened makes a
 * tile's defence roll d8s, Forward makes attacks from it roll d8s. One per
 * tile, bought with PP once Lattice Logistics is researched, on a tile with a
 * building; cleared on capture. Dice counts never change. Every game without
 * `galaxy_garrisons` rolls exactly the d6s it always did.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GARRISON_DOCTRINE_COST } from '@borderfall/shared';
import type { GameMap, GameSettings, GameState, TerritoryState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { onTerritoryCapture } from './economyManager';
import { normalizeGameSettings } from './gameSettings';
import {
  applyGarrisonDoctrine,
  attackerDieFaces,
  countPlayerDoctrines,
  defenderDieFaces,
  GARRISON_DOCTRINE_TUNING,
  validateGarrisonDoctrine,
} from './garrisonDoctrines';
import { dieFromD6Stream, resolveCombat } from '../combat/combatResolver';
import { computeLandCombatModifiers } from '../combat/combatModifiers';
import { executeLandAttack } from '../combat/executeLandAttack';
import { captureProbability, exchangeLossDistribution } from '../combat/combatOdds';
import { selectAiGarrisonDoctrines, type AiAction } from '../ai/aiBot';
import { maskHiddenTerritories } from '../../sockets/clientStateRedaction';

const GALAXY = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

/** A Sol gateway, its lane's far end on Verdan, and an interior Sol tile beside it. */
const SOL_GATE = 'sol_guinea';
const VERDAN_GATE = 'verdan_chlorophage_span';
const SOL_INLAND = 'sol_columbia';

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true, world_rules_enabled: false,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    galaxy_garrisons: true,
    ...overrides,
  } as unknown as GameSettings;
}

const FOUR = ['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians'];
const SOL = 'p_stellar_mandate';
const VERDAN = 'p_helion_navigators';

function galaxyGame(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(GALAXY)) as GameMap;
  const players = FOUR.map((faction_id, i) => ({
    player_id: `p_${faction_id}`, player_index: i, username: faction_id, color: '#fff',
    is_ai: true, is_eliminated: false, mmr: 1000, faction_id,
  }));
  const state = initializeGameState('t_garrisons', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  for (const p of state.players) {
    p.special_resource = 50;
    p.unlocked_techs = ['ga_lattice_logistics'];
  }
  // Sol holds its gateway, with a building; Verdan holds the far end.
  state.territories[SOL_GATE].owner_id = SOL;
  state.territories[SOL_GATE].buildings = ['production_1'];
  state.territories[VERDAN_GATE].owner_id = VERDAN;
  state.territories[VERDAN_GATE].buildings = ['defense_1'];
  return { state, map };
}

/** A d6 stream that plays back `values`, then sixes. */
function rigged(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 6;
}

afterEach(() => {
  GARRISON_DOCTRINE_TUNING.cost = GARRISON_DOCTRINE_COST;
});

describe('dice faces', () => {
  it('reads the doctrine only in a game that plays them', () => {
    const { state } = galaxyGame();
    state.territories[SOL_GATE].garrison_doctrine = 'forward';
    state.territories[VERDAN_GATE].garrison_doctrine = 'hardened';
    expect(attackerDieFaces(state, SOL_GATE)).toBe(8);
    expect(defenderDieFaces(state, VERDAN_GATE)).toBe(8);
    // The wrong doctrine for the side does nothing.
    expect(defenderDieFaces(state, SOL_GATE)).toBe(6);
    expect(attackerDieFaces(state, VERDAN_GATE)).toBe(6);

    state.settings.galaxy_garrisons = undefined;
    expect(attackerDieFaces(state, SOL_GATE)).toBe(6);
    expect(defenderDieFaces(state, VERDAN_GATE)).toBe(6);
  });

  it('a stack that went neutral does not keep the garrison\'s doctrine', () => {
    const { state } = galaxyGame();
    state.territories[VERDAN_GATE].garrison_doctrine = 'hardened';
    state.territories[VERDAN_GATE].owner_id = null;
    expect(defenderDieFaces(state, VERDAN_GATE)).toBe(6);
  });

  it('the combat modifiers carry the faces beside the dice counts', () => {
    const { state } = galaxyGame();
    state.territories[SOL_GATE].garrison_doctrine = 'forward';
    state.territories[VERDAN_GATE].garrison_doctrine = 'hardened';
    const mods = computeLandCombatModifiers({
      state, fromId: SOL_GATE, toId: VERDAN_GATE, attackerId: SOL, defenderId: VERDAN,
      attackingUnits: 6, defendingUnits: 3,
    });
    expect([mods.attackerDieFaces, mods.defenderDieFaces]).toEqual([8, 8]);
  });
});

describe('the resolver', () => {
  it('draws a uniform d8 from two d6s, deterministically', () => {
    const counts = new Array(9).fill(0);
    let rejected = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        if ((a - 1) * 6 + (b - 1) >= 32) { rejected++; continue; }
        counts[dieFromD6Stream(8, rigged([a, b]))]++;
      }
    }
    expect(counts.slice(1)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
    expect(rejected).toBe(4);
    // A rejected pair draws again; a stream that only ever rejects still returns.
    expect(dieFromD6Stream(8, rigged([6, 6, 1, 1]))).toBe(1);
    expect(dieFromD6Stream(8, () => 6)).toBeGreaterThanOrEqual(1);
  });

  it('six faces consume the d6 stream exactly as before', () => {
    const plain = resolveCombat(4, 2, undefined, undefined, rigged([6, 5, 4, 3, 2]));
    const explicit = resolveCombat(4, 2, undefined, undefined, rigged([6, 5, 4, 3, 2]), undefined, { attacker: 6, defender: 6 });
    expect(explicit).toEqual(plain);
    expect(plain.attacker_die_faces).toBeUndefined();
    expect(plain.defender_die_faces).toBeUndefined();
  });

  it('a d8 side rolls up to 8 and the result says so; counts never change', () => {
    // Attacker: two d8s from (2,2)→8 and (2,1)→7; defender d6: 6.
    const r = resolveCombat(3, 1, undefined, undefined, rigged([2, 2, 2, 1, 6]), undefined, { attacker: 8 });
    expect(r.attacker_rolls).toEqual([8, 7]);
    expect(r.defender_rolls).toEqual([6]);
    expect(r.attacker_die_faces).toBe(8);
    expect(r.defender_die_faces).toBeUndefined();
    expect(r.territory_captured).toBe(true);
  });
});

describe('a land attack', () => {
  it('rolls d8s for a Forward source and a Hardened target, and names them', () => {
    const { state } = galaxyGame();
    state.territories[SOL_GATE].unit_count = 6;
    state.territories[VERDAN_GATE].unit_count = 3;
    state.territories[SOL_GATE].garrison_doctrine = 'forward';
    state.territories[VERDAN_GATE].garrison_doctrine = 'hardened';
    const out = executeLandAttack(state, SOL, SOL_GATE, VERDAN_GATE, { dieRoll: rigged(Array(40).fill(3)) });
    expect(out?.result.attacker_die_faces).toBe(8);
    expect(out?.result.defender_die_faces).toBe(8);
    expect(out?.result.attacker_doctrine).toBe('forward');
    expect(out?.result.defender_doctrine).toBe('hardened');
  });

  it('rolls d6s, with nothing named, in a game without doctrines', () => {
    const { state } = galaxyGame({ galaxy_garrisons: undefined });
    state.territories[SOL_GATE].unit_count = 6;
    state.territories[VERDAN_GATE].unit_count = 3;
    state.territories[SOL_GATE].garrison_doctrine = 'forward';
    const out = executeLandAttack(state, SOL, SOL_GATE, VERDAN_GATE, { dieRoll: rigged(Array(40).fill(3)) });
    expect(out?.result.attacker_die_faces).toBeUndefined();
    expect(out?.result.attacker_doctrine).toBeUndefined();
  });

  it('capture clears the doctrine, on a gateway or an interior tile alike', () => {
    const { state } = galaxyGame();
    const gate = state.territories[VERDAN_GATE];
    gate.garrison_doctrine = 'hardened';
    gate.owner_id = SOL;
    onTerritoryCapture(state, VERDAN_GATE);
    expect(gate.garrison_doctrine).toBeUndefined();
  });
});

describe('the odds model', () => {
  it('a single d8 against a single d6 wins 27/48; a d6 against a d8 wins 15/48', () => {
    const forward = exchangeLossDistribution(1, 1, false, 8, 6);
    expect(forward[1]).toBeCloseTo(27 / 48, 10);
    const hardened = exchangeLossDistribution(1, 1, false, 6, 8);
    expect(hardened[1]).toBeCloseTo(15 / 48, 10);
    expect(exchangeLossDistribution(1, 1)[1]).toBeCloseTo(15 / 36, 10);
  });

  it('every distribution sums to 1', () => {
    for (const [a, d, fa, fd] of [[3, 2, 8, 6], [2, 2, 6, 8], [3, 3, 8, 8], [5, 4, 8, 8]] as const) {
      const dist = exchangeLossDistribution(a, d, false, fa, fd);
      expect(dist.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    }
  });

  it('a Hardened garrison is harder to take, a Forward attacker more likely to take it', () => {
    const base = captureProbability(8, 4);
    expect(captureProbability(8, 4, { defenderDieFaces: 8 })).toBeLessThan(base);
    expect(captureProbability(8, 4, { attackerDieFaces: 8 })).toBeGreaterThan(base);
  });
});

describe('buying a doctrine', () => {
  it('passes on a held tile with a building, the research and the price', () => {
    const { state } = galaxyGame();
    expect(validateGarrisonDoctrine(state, SOL, SOL_GATE, 'hardened')).toEqual({ valid: true, cost: 6 });
  });

  it('refuses everything the rule names, each with its reason', () => {
    const { state } = galaxyGame();
    const v = (patch: () => void, territoryId = SOL_GATE, doctrine: unknown = 'hardened') => {
      const fresh = galaxyGame();
      Object.assign(state, fresh.state);
      patch();
      return validateGarrisonDoctrine(state, SOL, territoryId, doctrine).error;
    };
    expect(v(() => { state.settings.galaxy_garrisons = undefined; })).toMatch(/not enabled/);
    expect(v(() => { state.settings.economy_enabled = false; })).toMatch(/Economy/);
    expect(v(() => {}, SOL_GATE, 'elite')).toMatch(/Unknown/);
    expect(v(() => {}, VERDAN_GATE)).toMatch(/you hold/);
    expect(v(() => { state.territories[SOL_GATE].buildings = []; })).toMatch(/needs a building/);
    expect(v(() => { state.players[0].unlocked_techs = []; })).toMatch(/Lattice Logistics/);
    expect(v(() => { state.players[0].special_resource = 5; })).toMatch(/costs 6 PP/);
    expect(v(() => { state.territories[SOL_GATE].garrison_doctrine = 'hardened'; })).toMatch(/already holds/);
  });

  it('with tech trees off, the research is not asked for', () => {
    const { state } = galaxyGame({ tech_trees_enabled: false });
    state.players[0].unlocked_techs = [];
    expect(validateGarrisonDoctrine(state, SOL, SOL_GATE, 'forward').valid).toBe(true);
  });

  it('spends the PP and replaces the other doctrine with no refund', () => {
    const { state } = galaxyGame();
    applyGarrisonDoctrine(state, SOL, SOL_GATE, 'hardened');
    expect(state.territories[SOL_GATE].garrison_doctrine).toBe('hardened');
    expect(state.players[0].special_resource).toBe(44);
    expect(validateGarrisonDoctrine(state, SOL, SOL_GATE, 'forward').valid).toBe(true);
    applyGarrisonDoctrine(state, SOL, SOL_GATE, 'forward');
    expect(state.territories[SOL_GATE].garrison_doctrine).toBe('forward');
    expect(state.players[0].special_resource).toBe(38);
    expect(countPlayerDoctrines(state, SOL)).toEqual({ hardened: 0, forward: 1 });
  });

  it('the price is a knob', () => {
    const { state } = galaxyGame();
    GARRISON_DOCTRINE_TUNING.cost = 9;
    expect(validateGarrisonDoctrine(state, SOL, SOL_GATE, 'forward').cost).toBe(9);
  });
});

describe('the AI', () => {
  const crossing: AiAction[] = [{ type: 'attack', from: SOL_GATE, to: VERDAN_GATE, units: 3 }];

  it('trains nothing without the setting, or at easy and tutorial', () => {
    expect(selectAiGarrisonDoctrines(galaxyGame({ galaxy_garrisons: undefined }).state, GALAXY, SOL, 'expert', crossing)).toEqual([]);
    expect(selectAiGarrisonDoctrines(galaxyGame().state, GALAXY, SOL, 'easy', crossing)).toEqual([]);
    expect(selectAiGarrisonDoctrines(galaxyGame().state, GALAXY, SOL, 'tutorial', crossing)).toEqual([]);
  });

  it('hard and expert: Forward on the planned crossing source', () => {
    const { state, map } = galaxyGame();
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'hard', crossing)[0]).toEqual({ territoryId: SOL_GATE, doctrine: 'forward' });
  });

  it('Hardened on a gateway facing a rival across its lane; medium buys Hardened only', () => {
    const { state, map } = galaxyGame();
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'hard', [])).toEqual([{ territoryId: SOL_GATE, doctrine: 'hardened' }]);
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'medium', crossing)).toEqual([{ territoryId: SOL_GATE, doctrine: 'hardened' }]);
  });

  it('never queues more than the purse covers, or a tile that fails the rule', () => {
    const { state, map } = galaxyGame();
    state.players[0].special_resource = 5;
    expect(selectAiGarrisonDoctrines(state, map, SOL, 'expert', crossing)).toEqual([]);
    const noTech = galaxyGame();
    noTech.state.players[0].unlocked_techs = [];
    expect(selectAiGarrisonDoctrines(noTech.state, noTech.map, SOL, 'expert', crossing)).toEqual([]);
    // An inland tile has no lane, so it is never Hardened for a lane threat.
    const inland = galaxyGame();
    inland.state.territories[SOL_INLAND].owner_id = SOL;
    inland.state.territories[SOL_INLAND].buildings = ['production_1'];
    const picks = selectAiGarrisonDoctrines(inland.state, inland.map, SOL, 'expert', []);
    expect(picks.some((p) => p.territoryId === SOL_INLAND)).toBe(false);
  });
});

describe('fog and settings', () => {
  it('a hidden tile\'s doctrine is masked like its buildings', () => {
    const t: TerritoryState = {
      territory_id: 'x', owner_id: 'p2', unit_count: 4, unit_type: 'infantry',
      buildings: ['defense_1'], garrison_doctrine: 'hardened',
    };
    expect(maskHiddenTerritories({ x: t }, new Set()).x.garrison_doctrine).toBeUndefined();
    expect(maskHiddenTerritories({ x: t }, new Set(['x'])).x.garrison_doctrine).toBe('hardened');
  });

  it('normalizes galaxy_garrisons as present only when on', () => {
    expect(normalizeGameSettings({}).galaxy_garrisons).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_garrisons: false }).galaxy_garrisons).toBeUndefined();
    expect(normalizeGameSettings({ galaxy_garrisons: true }).galaxy_garrisons).toBe(true);
  });
});

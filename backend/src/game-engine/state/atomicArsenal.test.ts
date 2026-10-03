/**
 * WW2 Manhattan Project, Phase 3 (docs/WW2_MANHATTAN_PROJECT.md §5): under
 * `settings.ww2_atomic_arsenal` the Atom Bomb is once per turn at an escalating
 * PP price, leaves fallout, costs the bomber stability, and proliferates.
 * Without the setting every path is the once-per-game bomb it was.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WW2_ATOMIC_ARSENAL, atomBombPrice } from '@borderfall/shared';
import type { GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import { collectProduction, validateBuild } from './economyManager';
import { getEffectiveTechCost } from './techManager';
import { applyFalloutAttrition, nextAtomBombPrice, proliferationApplies } from './atomicArsenal';
import { executeTechAbility, isGameScopedAbility } from '../abilities/executeTechAbility';
import { getCarryableLegacyAbility } from '../abilities/techAbilities';
import { WW2_TECH_TREE } from '../eras/ww2';
import { selectAiAtomBombStrike } from '../ai/aiAtomBomb';

const WW2 = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8'),
) as GameMap;
const MANHATTAN_PATH = ['ww2_motorization', 'ww2_tanks', 'ww2_panzer_tactics', 'ww2_atom_bomb'];

function game(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(WW2)) as GameMap;
  const players = [0, 1].map((i) => ({
    player_id: `p${i}`, player_index: i, username: `p${i}`, color: '#fff',
    is_ai: true, is_eliminated: false, mmr: 1000,
  }));
  const state = initializeGameState('ww2_arsenal', 'ww2', map, players, {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: false, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ww2_atomic_arsenal: true,
    ...overrides,
  } as unknown as GameSettings, { forceStartingPlayerIndex: 0 });
  // p0 holds the first half of the board, p1 the rest; p0 has the bomb and a purse.
  const ids = Object.keys(state.territories).sort();
  ids.forEach((id, i) => {
    const t = state.territories[id]!;
    t.owner_id = i < ids.length / 2 ? 'p0' : 'p1';
    t.unit_count = 5;
    t.buildings = [];
    t.stability = 80;
  });
  for (const p of state.players) p.territory_count = ids.filter((id) => state.territories[id]!.owner_id === p.player_id).length;
  state.players[0]!.unlocked_techs = [...MANHATTAN_PATH];
  state.players[0]!.special_resource = 100;
  state.phase = 'attack';
  return { state, map };
}

const enemyTile = (state: GameState): string => Object.keys(state.territories).sort().reverse()[0]!;
const bomb = (state: GameState, map: GameMap, target = enemyTile(state)) =>
  executeTechAbility({ state, map, playerId: 'p0', abilityId: 'atom_bomb', territoryId: target });

describe('the price', () => {
  it('is 15 PP, then 5 more for each detonation, and is refused when the purse is short', () => {
    expect([0, 1, 2].map(atomBombPrice)).toEqual([15, 20, 25]);
    const { state, map } = game();
    const me = state.players[0]!;
    expect(nextAtomBombPrice(me)).toBe(WW2_ATOMIC_ARSENAL.firstPrice);
    const first = bomb(state, map);
    expect(first.success).toBe(true);
    expect(first.productionSpent).toBe(15);
    expect(me.special_resource).toBe(85);
    expect(me.atom_bomb_uses).toBe(1);
    expect(nextAtomBombPrice(me)).toBe(20);
    me.special_resource = 19;
    const short = bomb(state, map, Object.keys(state.territories).sort().reverse()[1]);
    expect(short.success).toBe(false);
    expect(short.error).toMatch(/costs 20 PP/);
    expect(me.special_resource).toBe(19);
  });

  it('is once per turn rather than once per game, and only under the setting', () => {
    const { state, map } = game();
    expect(isGameScopedAbility('atom_bomb', state)).toBe(false);
    expect(bomb(state, map).success).toBe(true);
    expect(state.players[0]!.used_game_abilities ?? []).not.toContain('atom_bomb');
    const off = game({ ww2_atomic_arsenal: undefined });
    expect(isGameScopedAbility('atom_bomb', off.state)).toBe(true);
    expect(isGameScopedAbility('atom_bomb')).toBe(true);
    expect(bomb(off.state, off.map).success).toBe(true);
    expect(off.state.players[0]!.used_game_abilities).toContain('atom_bomb');
    expect(off.state.players[0]!.special_resource).toBe(100);
    expect(off.state.territories[enemyTile(off.state)]!.fallout_rounds).toBeUndefined();
  });
});

describe('fallout', () => {
  it('marks the tile for three rounds; a holder loses a unit a round, never below one; then it clears', () => {
    const { state, map } = game();
    const target = enemyTile(state);
    bomb(state, map);
    const t = state.territories[target]!;
    expect(t.owner_id).toBeNull();
    expect(t.unit_count).toBe(1);
    expect(t.fallout_rounds).toBe(WW2_ATOMIC_ARSENAL.falloutRounds);
    // Walked into with 3.
    t.owner_id = 'p0';
    t.unit_count = 3;
    expect(applyFalloutAttrition(state)).toEqual([{ territory_id: target, lost: 1 }]);
    expect(applyFalloutAttrition(state)).toEqual([{ territory_id: target, lost: 1 }]);
    expect(t.unit_count).toBe(1);
    expect(applyFalloutAttrition(state)).toEqual([]);
    expect(t.fallout_rounds).toBeUndefined();
  });

  it('ticks once per round with the storms', () => {
    const { state, map } = game();
    const target = enemyTile(state);
    bomb(state, map);
    const before = state.turn_number;
    while (state.turn_number === before) advanceToNextPlayer(state, map);
    expect(state.territories[target]!.fallout_rounds).toBe(WW2_ATOMIC_ARSENAL.falloutRounds - 1);
  });

  it('pays no income and takes no building while it lasts', () => {
    const { state, map } = game();
    const target = enemyTile(state);
    bomb(state, map);
    const t = state.territories[target]!;
    t.owner_id = 'p1';
    t.unit_count = 2;
    state.players[1]!.unlocked_techs = ['ww2_war_industry'];
    state.players[1]!.special_resource = 50;
    expect(validateBuild(state, 'p1', target, 'production_1').error).toMatch(/[Ff]allout/);
    const withFallout = collectProduction(state, 'p1').productionEarned;
    delete t.fallout_rounds;
    state.players[1]!.special_resource = 50;
    const clean = collectProduction(state, 'p1').productionEarned;
    // One tile fewer counted toward the base income of 1 per 3 territories.
    const owned = Object.values(state.territories).filter((x) => x.owner_id === 'p1').length;
    expect(clean - withFallout).toBe(Math.floor(owned / 3) - Math.floor((owned - 1) / 3));
  });
});

describe('the home cost and proliferation', () => {
  it('takes 10 stability from every territory of the bomber, in a game with stability', () => {
    const { state, map } = game();
    bomb(state, map);
    for (const t of Object.values(state.territories)) {
      if (t.owner_id === 'p0') expect(t.stability).toBe(80 - WW2_ATOMIC_ARSENAL.homeStabilityLoss);
      if (t.owner_id === 'p1') expect(t.stability).toBe(80);
    }
  });

  it('halves Manhattan Project for everyone without it once anyone has detonated', () => {
    const { state, map } = game();
    const manhattan = WW2_TECH_TREE.find((n) => n.tech_id === 'ww2_atom_bomb')!;
    const rival = state.players[1]!;
    expect(proliferationApplies(state, rival, manhattan)).toBe(false);
    expect(getEffectiveTechCost(state, rival, manhattan)).toBe(20);
    bomb(state, map);
    expect(getEffectiveTechCost(state, rival, manhattan)).toBe(10);
    // Never for the node's holder, and never another node.
    expect(proliferationApplies(state, state.players[0]!, manhattan)).toBe(false);
    const radar = WW2_TECH_TREE.find((n) => n.tech_id === 'ww2_radar')!;
    expect(getEffectiveTechCost(state, rival, radar)).toBe(radar.cost);
    // Off, nothing proliferates.
    const off = game({ ww2_atomic_arsenal: undefined });
    bomb(off.state, off.map);
    expect(getEffectiveTechCost(off.state, off.state.players[1]!, manhattan)).toBe(20);
  });
});

describe('Full Game carry', () => {
  it('carries a charge for a holder who has already detonated, which fires without the price', () => {
    const { state, map } = game();
    bomb(state, map);
    const me = state.players[0]!;
    expect(getCarryableLegacyAbility(state, me)).toBe('atom_bomb');
    // Advanced: the tech is gone, the charge stays.
    me.unlocked_techs = [];
    me.legacy_ability_charges = { atom_bomb: 1 };
    me.special_resource = 0;
    const res = bomb(state, map, Object.keys(state.territories).sort().reverse()[2]);
    expect(res.success).toBe(true);
    expect(res.productionSpent ?? 0).toBe(0);
    expect(me.atom_bomb_uses).toBe(2);
  });
});

describe('the bots', () => {
  it('fire again on a later turn when they can pay, and not twice in a turn', () => {
    // The bots' own setting (Phase 1) beside the arsenal's.
    const { state, map } = game({ ww2_bomb_ai: true });
    const me = state.players[0]!;
    state.territories[enemyTile(state)]!.unit_count = 12;
    const first = selectAiAtomBombStrike(state, map, 'p0');
    expect(first).not.toBeNull();
    expect(bomb(state, map, first!.territoryId).success).toBe(true);
    me.ability_uses = { atom_bomb: 1 };
    const second = Object.keys(state.territories).sort().reverse()[3]!;
    state.territories[second]!.unit_count = 14;
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
    me.ability_uses = {};
    expect(selectAiAtomBombStrike(state, map, 'p0')?.territoryId).toBe(second);
    me.special_resource = 5;
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
  });
});

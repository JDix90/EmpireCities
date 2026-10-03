/**
 * WW2 Manhattan Project, Phase 1 (docs/WW2_MANHATTAN_PROJECT.md §3): the bots
 * research toward the bomb, fire it at a target worth it, and walk in — only
 * under `settings.ww2_bomb_ai`. Without it the bots play exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from '../state/gameStateManager';
import { executeTechAbility } from '../abilities/executeTechAbility';
import { selectAiTechResearch } from './aiBot';
import {
  AI_BOMB_MIN_VALUE,
  applyBombElimination,
  selectAiAtomBombStrike,
  selectAiBombResearch,
} from './aiAtomBomb';

const WW2 = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8'),
) as GameMap;

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: false, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ww2_bomb_ai: true,
    ...overrides,
  } as unknown as GameSettings;
}

function ww2Game(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(WW2)) as GameMap;
  const players = [0, 1, 2].map((i) => ({
    player_id: `p${i}`, player_index: i, username: `p${i}`, color: '#fff',
    is_ai: true, is_eliminated: false, mmr: 1000,
  }));
  const state = initializeGameState('ww2_bomb', 'ww2', map, players, settings(overrides), { forceStartingPlayerIndex: 0 });
  return { state, map };
}

/** Hand the whole board out: p0 the first `mine` tiles, p1 the rest. */
function deal(state: GameState, mine: string[]): void {
  for (const [id, t] of Object.entries(state.territories)) {
    t.owner_id = mine.includes(id) ? 'p0' : 'p1';
    t.unit_count = 1;
    t.buildings = [];
  }
  for (const p of state.players) {
    p.territory_count = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
  }
}

function landNeighbour(map: GameMap, id: string): string {
  const c = map.connections.find((e) => e.type !== 'sea' && (e.from === id || e.to === id))!;
  return c.from === id ? c.to : c.from;
}

describe('research', () => {
  it('walks the bomb\'s prerequisite chain for hard and expert bots, and only under the setting', () => {
    const { state } = ww2Game();
    const me = state.players[0]!;
    me.tech_points = 30;
    expect(selectAiBombResearch(state, 'p0', 'expert')).toEqual({ techId: 'ww2_motorization', save: false });
    me.unlocked_techs = ['ww2_motorization', 'ww2_tanks'];
    expect(selectAiBombResearch(state, 'p0', 'hard')?.techId).toBe('ww2_panzer_tactics');
    me.unlocked_techs.push('ww2_panzer_tactics');
    expect(selectAiTechResearch(state, 'p0', 'expert')).toBe('ww2_atom_bomb');
    // Medium buys by price, as before; and nothing changes without the setting.
    expect(selectAiBombResearch(state, 'p0', 'medium')).toBeNull();
    const off = ww2Game({ ww2_bomb_ai: undefined });
    off.state.players[0]!.tech_points = 30;
    expect(selectAiBombResearch(off.state, 'p0', 'expert')).toBeNull();
  });

  it('keeps its points for the next node when it is a few turns of income away, and not when it is far', () => {
    const { state } = ww2Game();
    const me = state.players[0]!;
    me.unlocked_techs = ['ww2_motorization', 'ww2_tanks', 'ww2_panzer_tactics'];
    me.tech_points = 18; // Manhattan costs 20
    expect(selectAiBombResearch(state, 'p0', 'expert')).toEqual({ techId: null, save: true });
    expect(selectAiTechResearch(state, 'p0', 'expert')).toBeNull();
    me.tech_points = 0;
    deal(state, Object.keys(state.territories).slice(0, 3)); // 1 TP a turn: 20 is far
    expect(selectAiBombResearch(state, 'p0', 'expert')).toEqual({ techId: null, save: false });
  });

  it('has nothing to walk once the bomb is researched', () => {
    const { state } = ww2Game();
    state.players[0]!.unlocked_techs = ['ww2_motorization', 'ww2_tanks', 'ww2_panzer_tactics', 'ww2_atom_bomb'];
    expect(selectAiBombResearch(state, 'p0', 'expert')).toBeNull();
  });
});

describe('firing', () => {
  function armed(): { state: GameState; map: GameMap; target: string; from: string } {
    const { state, map } = ww2Game();
    const ids = Object.keys(state.territories).sort();
    const target = ids.find((id) => map.connections.some((c) => c.type !== 'sea' && (c.from === id || c.to === id)))!;
    const from = landNeighbour(map, target);
    deal(state, [from]);
    state.players[0]!.unlocked_techs = ['ww2_motorization', 'ww2_tanks', 'ww2_panzer_tactics', 'ww2_atom_bomb'];
    state.territories[from]!.unit_count = 6;
    state.territories[target]!.unit_count = 9;
    state.phase = 'attack';
    return { state, map, target, from };
  }

  it('picks the enemy tile worth the most and the stack that walks in', () => {
    const { state, map, target, from } = armed();
    const strike = selectAiAtomBombStrike(state, map, 'p0');
    expect(strike).toEqual({ territoryId: target, walkInFrom: from, value: 9 + 2 });
    // Buildings count: razing a Laboratory and a Fortress is worth two units each.
    const other = Object.keys(state.territories).find((id) => id !== target && id !== from)!;
    state.territories[other]!.unit_count = 6;
    state.territories[other]!.buildings = ['tech_gen_1', 'defense_2', 'production_1'];
    expect(selectAiAtomBombStrike(state, map, 'p0')?.territoryId).toBe(other);
  });

  it('waits for a target worth a once-per-game weapon, except on the last turn', () => {
    const { state, map, target } = armed();
    state.territories[target]!.unit_count = 2;
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
    expect(AI_BOMB_MIN_VALUE).toBe(8);
    state.turn_number = 90;
    expect(selectAiAtomBombStrike(state, map, 'p0')?.territoryId).toBe(target);
  });

  it('never bombs a truce partner, holds no bomb once it is spent, and does nothing without the setting', () => {
    const { state, map, target } = armed();
    state.diplomacy = [{ player_index_a: 0, player_index_b: 1, status: 'truce', truce_turns_remaining: 2 } as GameState['diplomacy'][number]];
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
    state.diplomacy = [];
    expect(executeTechAbility({ state, map, playerId: 'p0', abilityId: 'atom_bomb', territoryId: target }).success).toBe(true);
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
    const off = armed();
    off.state.settings.ww2_bomb_ai = undefined;
    expect(selectAiAtomBombStrike(off.state, off.map, 'p0')).toBeNull();
  });

  it('fires a charge carried from WW2 as well as the tech itself', () => {
    const { state, map } = armed();
    state.players[0]!.unlocked_techs = [];
    expect(selectAiAtomBombStrike(state, map, 'p0')).toBeNull();
    state.players[0]!.legacy_ability_charges = { atom_bomb: 1 };
    expect(selectAiAtomBombStrike(state, map, 'p0')).not.toBeNull();
  });
});

describe('elimination', () => {
  it('puts out a seat the bomb left with nothing, and hands its cards to the bomber', () => {
    const { state, map } = ww2Game();
    const ids = Object.keys(state.territories).sort();
    deal(state, ids.slice(1));
    const last = ids[0]!;
    state.territories[last]!.owner_id = 'p1';
    for (const t of Object.values(state.territories)) if (t.territory_id !== last && t.owner_id === 'p1') t.owner_id = 'p0';
    state.players[1]!.cards = [{ card_id: 'c1', territory_id: last, symbol: 'infantry' } as GameState['players'][number]['cards'][number]];
    state.phase = 'attack';
    const res = executeTechAbility({ state, map, playerId: 'p0', abilityId: 'atom_bomb', territoryId: last });
    expect(res.success).toBe(true);
    expect(applyBombElimination(state, 'p0', res.previousOwner)).toBe(true);
    expect(state.players[1]!.is_eliminated).toBe(true);
    expect(state.players[0]!.cards.map((c) => c.card_id)).toContain('c1');
    expect(applyBombElimination(state, 'p0', res.previousOwner)).toBe(false);
  });
});

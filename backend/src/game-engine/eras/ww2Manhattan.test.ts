/**
 * WW2 Manhattan Project, Phase 2 (docs/WW2_MANHATTAN_PROJECT.md §4): under
 * `settings.ww2_manhattan_science` Manhattan Project follows Radar Network, at
 * the same price; every other node, and every game without the setting, is
 * the tree as it was.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings } from '../../types';
import { eraTechTreeOptions, getEraTechTree } from '.';
import { WW2_TECH_TREE, ww2TechTree } from './ww2';
import { initializeGameState } from '../state/gameStateManager';
import { validateResearch } from '../state/techManager';

describe('the science line', () => {
  it('moves only Manhattan Project, to Radar Network, at the same price', () => {
    const science = ww2TechTree({ manhattanScience: true });
    const bomb = science.find((n) => n.tech_id === 'ww2_atom_bomb')!;
    expect(bomb.prerequisite).toBe('ww2_radar');
    expect(bomb.cost).toBe(20);
    expect(bomb.unlocks_ability).toBe('atom_bomb');
    for (const node of science) {
      if (node.tech_id === 'ww2_atom_bomb') continue;
      expect(node).toBe(WW2_TECH_TREE.find((n) => n.tech_id === node.tech_id));
    }
    expect(ww2TechTree()).toBe(WW2_TECH_TREE);
    expect(WW2_TECH_TREE.find((n) => n.tech_id === 'ww2_atom_bomb')!.prerequisite).toBe('ww2_panzer_tactics');
  });

  it('is selected by the setting, and by no other era', () => {
    const opts = eraTechTreeOptions({ ww2_manhattan_science: true });
    expect(getEraTechTree('ww2', opts).find((n) => n.tech_id === 'ww2_atom_bomb')!.prerequisite).toBe('ww2_radar');
    expect(getEraTechTree('ww2', eraTechTreeOptions({}))).toBe(WW2_TECH_TREE);
    expect(getEraTechTree('coldwar', opts)).toBe(getEraTechTree('coldwar'));
  });

  it('is the prerequisite research enforces', () => {
    const map = JSON.parse(readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8')) as GameMap;
    const game = (science: boolean) => initializeGameState('ww2_science', 'ww2', map, [0, 1].map((i) => ({
      player_id: `p${i}`, player_index: i, username: `p${i}`, color: '#fff', is_ai: true, is_eliminated: false, mmr: 1000,
    })), {
      fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
      diplomacy_enabled: false, factions_enabled: false, naval_enabled: false, events_enabled: false,
      economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
      allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
      ...(science ? { ww2_manhattan_science: true } : {}),
    } as unknown as GameSettings, { forceStartingPlayerIndex: 0 });

    const science = game(true);
    science.players[0]!.tech_points = 40;
    science.players[0]!.unlocked_techs = ['ww2_war_industry', 'ww2_munitions'];
    expect(validateResearch(science, 'p0', 'ww2_atom_bomb').error).toMatch(/ww2_radar/);
    science.players[0]!.unlocked_techs.push('ww2_radar');
    expect(validateResearch(science, 'p0', 'ww2_atom_bomb').valid).toBe(true);

    const tank = game(false);
    tank.players[0]!.tech_points = 40;
    tank.players[0]!.unlocked_techs = ['ww2_war_industry', 'ww2_munitions', 'ww2_radar'];
    expect(validateResearch(tank, 'p0', 'ww2_atom_bomb').error).toMatch(/ww2_panzer_tactics/);
  });
});

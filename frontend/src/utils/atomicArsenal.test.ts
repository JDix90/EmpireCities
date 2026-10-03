/**
 * WW2's atomic arsenal on the client (docs/WW2_MANHATTAN_PROJECT.md §5): the
 * territory panel offers the bomb once per turn at its price, names a tile's
 * fallout, and the tech tree prices Manhattan at half once anyone has bombed.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../store/gameStore';
import { atomBombPriceLabel, falloutLine, shownTechCost } from './atomicArsenal';
import { getTerritoryPanelAbilities } from './techAbilities';

const ARSENAL = { ww2_atomic_arsenal: true };
const MANHATTAN = { tech_id: 'ww2_atom_bomb', cost: 20, unlocks_ability: 'atom_bomb' };
const TREE = [{ tech_id: 'ww2_atom_bomb', unlocks_ability: 'atom_bomb' }];

function state(settings: Record<string, unknown>): GameState {
  return { phase: 'attack', settings: { tech_trees_enabled: true, ...settings } } as unknown as GameState;
}
function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', unlocked_techs: ['ww2_atom_bomb'], used_game_abilities: [], ...overrides } as PlayerState;
}

describe('the bomb in the territory panel', () => {
  it('is once per turn under the arsenal: a bomb used last turn is back, one used this turn is not', () => {
    const enemy = { isEnemy: true, isMine: false };
    // Under the arsenal the engine never records the bomb as spent for the game.
    expect(getTerritoryPanelAbilities(state(ARSENAL), player(), TREE, enemy)).toContain('atom_bomb');
    expect(getTerritoryPanelAbilities(state(ARSENAL), player({ ability_uses: { atom_bomb: 1 } }), TREE, enemy))
      .not.toContain('atom_bomb');
    // Without it, once per game as before.
    expect(getTerritoryPanelAbilities(state({}), player({ used_game_abilities: ['atom_bomb'] }), TREE, enemy))
      .not.toContain('atom_bomb');
  });

  it('names the price: 15 PP, 5 more for each bomb, nothing for a charge carried past WW2', () => {
    expect(atomBombPriceLabel(ARSENAL, { atom_bomb_uses: 0 }, true)).toBe(15);
    expect(atomBombPriceLabel(ARSENAL, { atom_bomb_uses: 2 }, true)).toBe(25);
    expect(atomBombPriceLabel(ARSENAL, { atom_bomb_uses: 2, legacy_ability_charges: { atom_bomb: 1 } }, false)).toBe(0);
    expect(atomBombPriceLabel({}, { atom_bomb_uses: 0 }, true)).toBeNull();
  });
});

describe('fallout', () => {
  it('is named while it lasts', () => {
    expect(falloutLine({ fallout_rounds: 3 })).toMatch(/3 rounds left/);
    expect(falloutLine({ fallout_rounds: 1 })).toMatch(/1 round left/);
    expect(falloutLine({})).toBeNull();
    expect(falloutLine(undefined)).toBeNull();
  });
});

describe('proliferation in the tech tree', () => {
  it('shows Manhattan at half once anyone has detonated, to a player without it, only under the arsenal', () => {
    const none = new Set<string>();
    expect(shownTechCost(ARSENAL, [{}, {}], none, MANHATTAN)).toBe(20);
    expect(shownTechCost(ARSENAL, [{ atom_bomb_uses: 1 }, {}], none, MANHATTAN)).toBe(10);
    expect(shownTechCost(ARSENAL, [{ atom_bomb_uses: 1 }], new Set(['ww2_atom_bomb']), MANHATTAN)).toBe(20);
    expect(shownTechCost({}, [{ atom_bomb_uses: 1 }], none, MANHATTAN)).toBe(20);
    expect(shownTechCost(ARSENAL, [{ atom_bomb_uses: 1 }], none, { tech_id: 'ww2_radar', cost: 11 })).toBe(11);
  });
});

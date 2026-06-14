import { describe, it, expect } from 'vitest';
import { getTerritoryPanelAbilities } from './techAbilities';
import type { GameState, PlayerState } from '../store/gameStore';

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'attack',
    settings: { tech_trees_enabled: true },
    ...overrides,
  } as unknown as GameState;
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', unlocked_techs: [], used_game_abilities: [], ...overrides } as PlayerState;
}

describe('getTerritoryPanelAbilities — legacy charge surfacing (#6)', () => {
  const enemyCtx = { isEnemy: true, isMine: false };

  it('surfaces a carried legacy Atom Bomb against an enemy in the attack phase', () => {
    const abilities = getTerritoryPanelAbilities(
      state(),
      player({ legacy_ability_charges: { atom_bomb: 1 } }), // tech gone, charge held
      [], // empty tech tree (advanced era)
      enemyCtx,
    );
    expect(abilities).toContain('atom_bomb');
  });

  it('does not surface a legacy ability once it has been consumed this game', () => {
    const abilities = getTerritoryPanelAbilities(
      state(),
      player({ legacy_ability_charges: { atom_bomb: 1 }, used_game_abilities: ['atom_bomb'] }),
      [],
      enemyCtx,
    );
    expect(abilities).not.toContain('atom_bomb');
  });

  it('does not surface a legacy attack ability outside the attack phase', () => {
    const abilities = getTerritoryPanelAbilities(
      state({ phase: 'draft' } as Partial<GameState>),
      player({ legacy_ability_charges: { atom_bomb: 1 } }),
      [],
      enemyCtx,
    );
    expect(abilities).not.toContain('atom_bomb');
  });
});

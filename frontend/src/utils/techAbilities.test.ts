import { describe, it, expect } from 'vitest';
import { getGlobalPanelAbilities, getTerritoryPanelAbilities } from './techAbilities';
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

describe('Moon-ground abilities reach the player who holds the ground', () => {
  const mine = { isEnemy: false, isMine: true };
  const moonState = (over: Record<string, unknown> = {}) =>
    state({
      phase: 'draft',
      settings: {
        tech_trees_enabled: true,
        space_age_moon_helium3_enabled: true,
        space_age_moon_gated_tier_enabled: true,
        ...over,
      },
    } as Partial<GameState>);

  it('offers Lunar Export to a Moon holder with no unlocking tech anywhere', () => {
    // The gap this closes: every other ability is surfaced by walking the tech
    // tree for `unlocks_ability`, and these two have none, so before this they
    // were unreachable in the UI however much lunar ground a player held.
    expect(getGlobalPanelAbilities(moonState(), player(), [], 1)).toContain('lunar_export');
  });

  it('withholds both from a player who holds no lunar ground', () => {
    expect(getGlobalPanelAbilities(moonState(), player(), [], 0)).not.toContain('lunar_export');
    expect(getTerritoryPanelAbilities(moonState(), player(), [], mine, 0)).not.toContain('orbital_drop');
  });

  it('holds Orbital Drop back until the third Moon tile', () => {
    expect(getTerritoryPanelAbilities(moonState(), player(), [], mine, 2)).not.toContain('orbital_drop');
    expect(getTerritoryPanelAbilities(moonState(), player(), [], mine, 3)).toContain('orbital_drop');
  });

  it('offers neither while the lunar economy is off', () => {
    const off = moonState({ space_age_moon_helium3_enabled: false });
    expect(getGlobalPanelAbilities(off, player(), [], 9)).not.toContain('lunar_export');
    expect(getTerritoryPanelAbilities(off, player(), [], mine, 9)).not.toContain('orbital_drop');
  });

  it('keeps Lunar Export when only Phase 2 is off', () => {
    // The phases ship independently; Phase 1's sink must not start depending on
    // the tier that came after it.
    const phase1Only = moonState({ space_age_moon_gated_tier_enabled: false });
    expect(getGlobalPanelAbilities(phase1Only, player(), [], 9)).toContain('lunar_export');
    expect(getTerritoryPanelAbilities(phase1Only, player(), [], mine, 9)).not.toContain('orbital_drop');
  });

  it('reaches a Lunar Pioneer in a game with tech trees switched off', () => {
    // Holding the Moon is the credential, and the Pioneers get there from turn
    // one without researching anything.
    const noTech = moonState({ tech_trees_enabled: false });
    expect(getTerritoryPanelAbilities(noTech, player(), [], mine, 4)).toContain('orbital_drop');
  });

  it('does not offer a drop during the attack phase', () => {
    const attacking = state({
      phase: 'attack',
      settings: {
        tech_trees_enabled: true,
        space_age_moon_helium3_enabled: true,
        space_age_moon_gated_tier_enabled: true,
      },
    } as Partial<GameState>);
    expect(getTerritoryPanelAbilities(attacking, player(), [], mine, 5)).not.toContain('orbital_drop');
  });

  it('does not offer a drop onto someone else\'s territory', () => {
    const enemyCtx = { isEnemy: true, isMine: false };
    expect(getTerritoryPanelAbilities(moonState(), player(), [], enemyCtx, 5)).not.toContain('orbital_drop');
  });

  it('hides a drop already used this turn', () => {
    const used = player({ ability_uses: { orbital_drop: 1 } });
    expect(getTerritoryPanelAbilities(moonState(), used, [], mine, 5)).not.toContain('orbital_drop');
  });
});

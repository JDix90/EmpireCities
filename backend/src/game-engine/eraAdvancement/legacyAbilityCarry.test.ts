import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { getEraTechTree } from '../eras';
import { executeAdvanceEra, buildAdvanceEraClientPreview } from './advanceEra';
import { resolvePlayerEraId } from './constants';
import { ERA_ADVANCEMENT_SPINES, getEffectiveMilestoneGate } from './spines';
import { getCarryableLegacyAbility } from '../abilities/techAbilities';
import { playerCanUseAbility } from '../abilities/executeTechAbility';

/** A WW2-era state (classic spine, current_era_index 3) that can advance to Cold War. */
function ww2State(): { state: GameState; player: PlayerState } {
  const territories: Record<string, TerritoryState> = {
    cap: { territory_id: 'cap', owner_id: 'p1', unit_count: 20, unit_type: 'infantry', buildings: ['production_1', 'production_2', 'defense_1'] },
    t2: { territory_id: 't2', owner_id: 'p1', unit_count: 10, unit_type: 'infantry' },
    e1: { territory_id: 'e1', owner_id: 'p2', unit_count: 4, unit_type: 'infantry' },
  };
  const player = {
    player_id: 'p1', player_index: 0, is_eliminated: false,
    special_resource: 100_000, last_turn_production_income: 20,
    current_era_index: 3, unlocked_techs: [], era_signature_charges: {}, era_advancement_tech_echo: {},
    used_game_abilities: [],
  } as PlayerState;
  const state = {
    game_id: 'g', era: 'ancient', phase: 'attack',
    players: [player, { player_id: 'p2', player_index: 1, is_eliminated: false } as PlayerState],
    territories,
    era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
    settings: { era_advancement_enabled: true, economy_enabled: true, tech_trees_enabled: true, stability_enabled: false, era_advancement_spine_id: 'classic' },
  } as GameState;
  return { state, player };
}

/** Unlock the gate techs for the current era plus (optionally) the Atom Bomb. */
function unlockGateTechs(state: GameState, player: PlayerState, withAtomBomb: boolean): void {
  const gate = getEffectiveMilestoneGate(state, player.player_id);
  const tree = getEraTechTree(resolvePlayerEraId(state, player));
  const byTier = (t: number) => tree.filter((n) => n.tier === t).map((n) => n.tech_id);
  player.unlocked_techs = [
    ...byTier(1).slice(0, gate.min_tier1_techs),
    ...byTier(2).slice(0, gate.min_tier2_techs),
    ...byTier(3).slice(0, gate.min_tier3_techs),
    ...(withAtomBomb ? ['ww2_atom_bomb'] : []),
  ];
}

describe('getCarryableLegacyAbility', () => {
  it('returns the unused once-per-game tech ability (Atom Bomb)', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, true);
    expect(getCarryableLegacyAbility(state, player)).toBe('atom_bomb');
  });

  it('returns null when the ability was already used', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, true);
    player.used_game_abilities = ['atom_bomb'];
    expect(getCarryableLegacyAbility(state, player)).toBeNull();
  });

  it('returns null when no once-per-game tech ability is unlocked', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, false);
    expect(getCarryableLegacyAbility(state, player)).toBeNull();
  });
});

describe('executeAdvanceEra — legacy ability carry', () => {
  it('carries an unused Atom Bomb into the next era as a one-time charge', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, true);
    const result = executeAdvanceEra(state, 'p1');
    expect(result.success).toBe(true);
    expect(resolvePlayerEraId(state, player)).toBe('coldwar');
    expect(player.unlocked_techs).toEqual([]); // tech reset
    expect(player.legacy_ability_charges).toEqual({ atom_bomb: 1 });
  });

  it('does not carry an Atom Bomb that was already detonated', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, true);
    player.used_game_abilities = ['atom_bomb'];
    executeAdvanceEra(state, 'p1');
    expect(player.legacy_ability_charges).toBeUndefined();
  });

  it('preserves a held legacy charge when the new era has nothing to carry', () => {
    const { state, player } = ww2State();
    // Already holding a carried Atom Bomb; this era's gate techs include no
    // once-per-game ability, so the held charge must survive the advance.
    player.legacy_ability_charges = { atom_bomb: 1 };
    unlockGateTechs(state, player, false);
    executeAdvanceEra(state, 'p1');
    expect(player.legacy_ability_charges).toEqual({ atom_bomb: 1 });
  });
});

describe('playerCanUseAbility — legacy bypass', () => {
  it('allows a carried ability even though its tech is gone', () => {
    const { state, player } = ww2State();
    // Cold War player, no atom_bomb tech, but holds the legacy charge.
    player.current_era_index = 4;
    player.unlocked_techs = [];
    player.legacy_ability_charges = { atom_bomb: 1 };
    expect(playerCanUseAbility(state, player, 'atom_bomb')).toBe(true);
  });

  it('blocks a carried ability already consumed this game', () => {
    const { state, player } = ww2State();
    player.current_era_index = 4;
    player.unlocked_techs = [];
    player.legacy_ability_charges = { atom_bomb: 1 };
    player.used_game_abilities = ['atom_bomb'];
    expect(playerCanUseAbility(state, player, 'atom_bomb')).toBe(false);
  });
});

describe('buildAdvanceEraClientPreview — legacy_ability surfacing', () => {
  it('reports the ability that will carry forward', () => {
    const { state, player } = ww2State();
    unlockGateTechs(state, player, true);
    const preview = buildAdvanceEraClientPreview(state, 'p1');
    expect(preview?.legacy_ability).toEqual({ ability_id: 'atom_bomb', label: 'Atom Bomb' });
  });
});

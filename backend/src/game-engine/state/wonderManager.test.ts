/**
 * Era wonders under era advancement.
 *
 * The defect this locks out: every lookup here used to resolve the wonder as
 * `getEraWonder(state.era)` — the era the MAP was made in, which never moves
 * when a player advances. A player who advanced, built their era's wonder and
 * paid for it owned a building the engine could not see; none of its bonuses
 * paid out, the "one per game" gate only ever looked for the base era's wonder
 * so a second wonder could stand, and because no tech node gates a wonder the
 * build path accepted ANY era's wonder id from ANY player.
 */
import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { ERA_ADVANCEMENT_SPINES } from '../eraAdvancement/spines';
import { applyBuild, validateBuild, onTerritoryCapture } from './economyManager';
import {
  getPlayerWonders,
  getStandingWonders,
  getWonderDefenseBonus,
  getWonderForPlayer,
  getWonderOwner,
  getWonderReinforceBonus,
  getWonderSeaAttackDice,
  getWonderTechCostMultiplier,
  isWonderBuilt,
  wonderUniquenessScope,
} from './wonderManager';

/** A = advanced to Medieval, B = still in the base era (Ancient). */
function world(overrides: Partial<GameState['settings']> = {}) {
  const territories: Record<string, TerritoryState> = {
    a1: { territory_id: 'a1', owner_id: 'A', unit_count: 5, unit_type: 'infantry', buildings: [] },
    a2: { territory_id: 'a2', owner_id: 'A', unit_count: 5, unit_type: 'infantry', buildings: [] },
    b1: { territory_id: 'b1', owner_id: 'B', unit_count: 5, unit_type: 'infantry', buildings: [] },
  };
  const A = { player_id: 'A', player_index: 0, is_eliminated: false, special_resource: 1000,
    current_era_index: 1, unlocked_techs: [] } as PlayerState;
  const B = { player_id: 'B', player_index: 1, is_eliminated: false, special_resource: 1000,
    current_era_index: 0, unlocked_techs: [] } as PlayerState;
  const state = {
    game_id: 'g', era: 'ancient', phase: 'draft', players: [A, B], territories,
    era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
    settings: {
      era_advancement_enabled: true, economy_enabled: true, tech_trees_enabled: true,
      era_advancement_spine_id: 'classic', ...overrides,
    },
  } as GameState;
  return { state, A, B };
}

describe('wonder resolution follows the board, not the base era', () => {
  it('pays an advanced player the bonuses of the wonder they actually built', () => {
    const { state } = world();
    // Notre-Dame: +2 draft per turn for its owner.
    expect(validateBuild(state, 'A', 'a1', 'wonder_cathedral', true).valid).toBe(true);
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');

    expect(getWonderOwner(state, 'wonder_cathedral')).toBe('A');
    expect(getPlayerWonders(state, 'A').map((w) => w.wonderId)).toEqual(['wonder_cathedral']);
    expect(getWonderReinforceBonus(state, 'A')).toBe(2);
    expect(getWonderReinforceBonus(state, 'B')).toBe(0);
  });

  it('offers each player the wonder of their OWN era', () => {
    const { state, A, B } = world();
    expect(getWonderForPlayer(state, A)?.wonder_id).toBe('wonder_cathedral'); // medieval
    expect(getWonderForPlayer(state, B)?.wonder_id).toBe('wonder_colosseum'); // ancient
  });

  it('moves the bonus to whoever captures the wonder', () => {
    const { state } = world();
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');
    expect(getWonderReinforceBonus(state, 'A')).toBe(2);

    // Capture razes every building except the wonder, which changes hands.
    state.territories.a1.owner_id = 'B';
    onTerritoryCapture(state, 'a1');
    expect(state.territories.a1.buildings).toEqual(['wonder_cathedral']);
    expect(getWonderReinforceBonus(state, 'A')).toBe(0);
    expect(getWonderReinforceBonus(state, 'B')).toBe(2);
  });
});

describe('the build gate', () => {
  it('refuses a wonder from an era the player is not in', () => {
    const { state } = world();
    // No tech node gates any wonder, so this used to be accepted outright.
    const modern = validateBuild(state, 'A', 'a1', 'wonder_cern', true);
    expect(modern.valid).toBe(false);
    expect(modern.error).toMatch(/only build your era's Wonder/i);
    // Even the BASE era's wonder is refused to a player who has left it.
    expect(validateBuild(state, 'A', 'a1', 'wonder_colosseum', true).valid).toBe(false);
  });

  it('still allows one wonder per territory only', () => {
    const { state } = world();
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');
    // Same territory, same player: blocked by the per-territory slot rule.
    expect(validateBuild(state, 'A', 'a1', 'wonder_cathedral', true).valid).toBe(false);
  });
});

describe('uniqueness scope', () => {
  it('defaults to one wonder per game, and enforces it across eras', () => {
    const { state } = world();
    expect(wonderUniquenessScope(state)).toBe('game');
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');

    // The old gate missed this: B is in Ancient, so it only looked for the
    // Colosseum and let a second wonder stand.
    expect(isWonderBuilt(state)).toBe(true);
    const second = validateBuild(state, 'B', 'b1', 'wonder_colosseum', true);
    expect(second.valid).toBe(false);
    expect(second.error).toMatch(/already been built/i);
  });

  it('per-era scope lets each era hold its own wonder, once', () => {
    const { state } = world({ era_wonder_per_era_enabled: true });
    expect(wonderUniquenessScope(state)).toBe('era');
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');

    // A different era's wonder is now available to the player in that era...
    expect(validateBuild(state, 'B', 'b1', 'wonder_colosseum', true).valid).toBe(true);
    applyBuild(state, 'B', 'b1', 'wonder_colosseum');
    expect(getStandingWonders(state).map((w) => w.wonderId).sort())
      .toEqual(['wonder_cathedral', 'wonder_colosseum']);

    // ...but each era's wonder is still a one-time prize. B already holds the
    // Colosseum, so no one may raise a second one.
    state.territories.a2.owner_id = 'B';
    expect(validateBuild(state, 'B', 'a2', 'wonder_colosseum', true).valid).toBe(false);
  });

  it('stacks passives across the wonders one player holds', () => {
    const { state } = world({ era_wonder_per_era_enabled: true });
    // A holds Notre-Dame (+2 draft) and, by conquest, the Colosseum (+1 defence).
    applyBuild(state, 'A', 'a1', 'wonder_cathedral');
    state.territories.b1.buildings = ['wonder_colosseum'];
    state.territories.b1.owner_id = 'A';

    expect(getWonderReinforceBonus(state, 'A')).toBe(2);
    expect(getWonderDefenseBonus(state, 'A')).toBe(1);
    expect(getPlayerWonders(state, 'A')).toHaveLength(2);
  });

  it('takes the highest sea-dice override rather than summing it', () => {
    const { state } = world({ era_wonder_per_era_enabled: true });
    // The Lighthouse REPLACES the die count; two of them must not mean six.
    state.territories.a1.buildings = ['wonder_lighthouse'];
    expect(getWonderSeaAttackDice(state, 'A')).toBe(3);
    state.territories.a2.buildings = ['wonder_lighthouse'];
    expect(getWonderSeaAttackDice(state, 'A')).toBe(3);
  });

  it('halves tech cost once for a CERN holder and leaves others at full price', () => {
    const { state } = world({ era_wonder_per_era_enabled: true });
    state.territories.a1.buildings = ['wonder_cern'];
    expect(getWonderTechCostMultiplier(state, 'A')).toBe(0.5);
    expect(getWonderTechCostMultiplier(state, 'B')).toBe(1);
  });
});

describe('games without era advancement', () => {
  it('behaves exactly as before: one wonder, the game era’s', () => {
    const { state } = world({ era_advancement_enabled: false });
    const solo = state.players[1]; // current_era_index 0
    expect(getWonderForPlayer(state, solo)?.wonder_id).toBe('wonder_colosseum');
    expect(validateBuild(state, 'B', 'b1', 'wonder_colosseum', true).valid).toBe(true);
    applyBuild(state, 'B', 'b1', 'wonder_colosseum');
    expect(getWonderOwner(state)).toBe('B');
    expect(getWonderDefenseBonus(state, 'B')).toBe(1);
    expect(isWonderBuilt(state)).toBe(true);
  });
});

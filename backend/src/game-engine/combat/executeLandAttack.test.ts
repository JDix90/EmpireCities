import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { executeLandAttack } from './executeLandAttack';

/** Deterministic dice: resolveCombat consumes all attacker dice, then all defender dice. */
function diceFrom(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++] ?? 1;
}

function terr(id: string, owner: string | null, units: number, extra: Partial<TerritoryState> = {}): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', ...extra } as TerritoryState;
}

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: id, cards: [], is_eliminated: false, territory_count: 1, ...overrides } as PlayerState;
}

function state(
  territories: Record<string, TerritoryState>,
  players: PlayerState[],
  settings: Partial<GameState['settings']> = {},
): GameState {
  return { players, territories, settings } as GameState;
}

describe('executeLandAttack', () => {
  it('captures and transfers a territory on a winning exchange', () => {
    const s = state(
      { a: terr('a', 'p1', 10), b: terr('b', 'p2', 1) },
      [player('p1', { territory_count: 1 }), player('p2', { territory_count: 1 })],
    );
    const out = executeLandAttack(s, 'p1', 'a', 'b', { dieRoll: diceFrom([6, 6, 6, 1]) });
    expect(out?.captured).toBe(true);
    expect(s.territories.b.owner_id).toBe('p1');
    expect(s.territories.b.unit_count).toBe(3); // min(from-1, 3) advance into the captured land
    expect(s.territories.a.unit_count).toBe(7); // remainder stays behind
    expect(out?.defenderEliminated).toBe(true); // p2 had only that territory
  });

  it('rejects structurally invalid attacks', () => {
    const s = state(
      { a: terr('a', 'p1', 1), b: terr('b', 'p2', 3), c: terr('c', 'p1', 5) },
      [player('p1'), player('p2')],
    );
    expect(executeLandAttack(s, 'p1', 'a', 'b')).toBeNull(); // < 2 units
    expect(executeLandAttack(s, 'p1', 'c', 'a')).toBeNull(); // target is own territory
    expect(executeLandAttack(s, 'p2', 'c', 'b')).toBeNull(); // p2 does not own the source
  });

  it('grants the era-gap attack die to an era-ahead attacker (EA-203 flows through)', () => {
    const settings = { era_advancement_enabled: true, era_advancement_combat_gap_dice: 1 };
    const ahead = state(
      { a: terr('a', 'p1', 10), b: terr('b', 'p2', 2) },
      [player('p1', { current_era_index: 1 }), player('p2', { current_era_index: 0 })],
      settings,
    );
    const level = state(
      { a: terr('a', 'p1', 10), b: terr('b', 'p2', 2) },
      [player('p1', { current_era_index: 0 }), player('p2', { current_era_index: 0 })],
      settings,
    );
    // Constant dice — we only assert the dice COUNT, which reflects the modifier.
    const aheadOut = executeLandAttack(ahead, 'p1', 'a', 'b', { dieRoll: () => 3 });
    const levelOut = executeLandAttack(level, 'p1', 'a', 'b', { dieRoll: () => 3 });
    expect(aheadOut?.result.attacker_rolls).toHaveLength(4); // base 3 + 1 era-gap die
    expect(levelOut?.result.attacker_rolls).toHaveLength(3); // base only
  });

  it('shrinks the defender dice pool during the vulnerability window', () => {
    const s = state(
      { a: terr('a', 'p1', 10), b: terr('b', 'p2', 4) },
      [
        player('p1', { current_era_index: 0 }),
        player('p2', { current_era_index: 0, era_transition_turns_remaining: 1 }),
      ],
      { era_advancement_enabled: true, era_advancement_vuln_defense_mult: 0.75 },
    );
    const out = executeLandAttack(s, 'p1', 'a', 'b', { dieRoll: () => 3 });
    // 4 defenders would normally roll 2 dice; the vulnerability multiplier floors it to 1.
    expect(out?.result.defender_rolls).toHaveLength(1);
  });
});

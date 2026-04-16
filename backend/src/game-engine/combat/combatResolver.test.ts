import { describe, it, expect } from 'vitest';
import { resolveCombat, getCardSetBonus, calculateReinforcements } from './combatResolver';

function sequencer(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 1;
}

describe('resolveCombat', () => {
  it('returns error if attacker has fewer than 2 units', () => {
    const result = resolveCombat(1, 3);
    expect(result.error).toMatch(/at least 2 units/);
    expect(result.attacker_losses).toBe(0);
    expect(result.defender_losses).toBe(0);
    expect(result.territory_captured).toBe(false);
  });

  it('returns error if defender has fewer than 1 unit', () => {
    const result = resolveCombat(3, 0);
    expect(result.error).toMatch(/at least 1 unit/);
    expect(result.attacker_losses).toBe(0);
    expect(result.defender_losses).toBe(0);
    expect(result.territory_captured).toBe(false);
  });

  it('compares highest dice; defender wins ties (attacker loses)', () => {
    const r = resolveCombat(4, 3, undefined, undefined, sequencer([3, 3, 3, 3, 3]));
    expect(r.attacker_rolls).toEqual([3, 3, 3]);
    expect(r.defender_rolls).toEqual([3, 3]);
    expect(r.attacker_losses).toBe(2);
    expect(r.defender_losses).toBe(0);
  });

  it('attacker wins both comparisons when dice are higher', () => {
    const r = resolveCombat(5, 3, undefined, undefined, sequencer([6, 5, 4, 2, 1]));
    expect(r.attacker_losses).toBe(0);
    expect(r.defender_losses).toBe(2);
  });

  it('caps defender losses at defending unit count', () => {
    const r = resolveCombat(5, 1, undefined, undefined, sequencer([6, 6, 6, 1, 1]));
    expect(r.defender_losses).toBe(1);
  });

  it('keeps the default cap at 3 attack dice vs 2 defense dice regardless of large armies', () => {
    const r = resolveCombat(8, 7, undefined, undefined, sequencer([6, 5, 4, 3, 2]));
    expect(r.attacker_rolls).toHaveLength(3);
    expect(r.defender_rolls).toHaveLength(2);
  });

  it('still allows explicit bonus overrides to add extra dice', () => {
    const r = resolveCombat(8, 7, 4, 3, sequencer([6, 5, 4, 3, 2, 1, 1]));
    expect(r.attacker_rolls).toHaveLength(4);
    expect(r.defender_rolls).toHaveLength(3);
  });
});

describe('getCardSetBonus', () => {
  it('returns schedule values for early redemptions', () => {
    expect(getCardSetBonus(0)).toBe(4);
    expect(getCardSetBonus(1)).toBe(6);
    expect(getCardSetBonus(5)).toBe(15);
  });

  it('ramps after schedule', () => {
    expect(getCardSetBonus(6)).toBe(20);
  });
});

describe('calculateReinforcements', () => {
  it('gives minimum 3 from low territory count', () => {
    expect(calculateReinforcements(5, 0, 6)).toBe(3);
  });

  it('adds scaled continent bonus', () => {
    const r = calculateReinforcements(10, 6, 6);
    expect(r).toBeGreaterThanOrEqual(3);
  });
});

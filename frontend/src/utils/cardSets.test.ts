import { describe, it, expect } from 'vitest';
import { cardSetBonus, findRedeemableCardIds, isValidCardSet } from './cardSets';

const card = (card_id: string, symbol: string) => ({ card_id, symbol });

describe('cardSets (mirrors the server)', () => {
  it('accepts three of a kind, one of each, and a pair plus a wild', () => {
    expect(isValidCardSet(['infantry', 'infantry', 'infantry'])).toBe(true);
    expect(isValidCardSet(['infantry', 'cavalry', 'artillery'])).toBe(true);
    expect(isValidCardSet(['cavalry', 'cavalry', 'wild'])).toBe(true);
    expect(isValidCardSet(['infantry', 'cavalry', 'wild'])).toBe(true);
    expect(isValidCardSet(['wild', 'wild', 'artillery'])).toBe(true);
  });

  it('refuses a pair plus an odd card', () => {
    expect(isValidCardSet(['infantry', 'infantry', 'cavalry'])).toBe(false);
  });

  it('finds the first set in card_id order, or none', () => {
    expect(findRedeemableCardIds([card('a', 'infantry'), card('b', 'infantry')])).toBeNull();
    expect(
      findRedeemableCardIds([card('a', 'infantry'), card('b', 'infantry'), card('c', 'cavalry')]),
    ).toBeNull();
    expect(
      findRedeemableCardIds([
        card('d', 'artillery'),
        card('a', 'infantry'),
        card('c', 'cavalry'),
        card('b', 'infantry'),
      ]),
    ).toEqual(['a', 'c', 'd']);
  });

  it('pays the shared schedule, clamped by the cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => cardSetBonus(n))).toEqual([4, 6, 8, 10, 12, 15, 20, 25, 30, 35]);
    expect(cardSetBonus(9, 30)).toBe(30);
    expect(cardSetBonus(0, 30)).toBe(4);
    expect(cardSetBonus(9, 0)).toBe(35);
  });
});

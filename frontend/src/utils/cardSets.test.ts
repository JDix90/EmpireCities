import { describe, it, expect } from 'vitest';
import { cardPickView, cardSetBonus, findRedeemableCardIds, isValidCardSet, validSetsInHand } from './cardSets';

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

describe('the cards UI view of a hand (card_sets_explain_enabled)', () => {
  // Two infantry, a cavalry, an artillery: two one-of-each sets, no three of a kind.
  const hand = [card('c1', 'infantry'), card('c2', 'infantry'), card('c3', 'cavalry'), card('c4', 'artillery')];

  it('lists every valid set in the hand', () => {
    expect(validSetsInHand(hand)).toEqual([['c1', 'c3', 'c4'], ['c2', 'c3', 'c4']]);
    expect(validSetsInHand([card('a', 'infantry'), card('b', 'infantry'), card('c', 'cavalry')])).toEqual([]);
  });

  it('marks the cards that make a set and the set a one-tap trade takes', () => {
    const view = cardPickView(hand, []);
    expect([...view.inSet].sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(view.pick).toBe('none');
    expect(view.firstSet).toEqual(['c1', 'c3', 'c4']);
    const none = cardPickView([card('a', 'infantry'), card('b', 'infantry'), card('c', 'cavalry')], []);
    expect(none.inSet.size).toBe(0);
    expect(none.firstSet).toBeNull();
  });

  it('with one infantry picked, the other infantry cannot finish a set', () => {
    const view = cardPickView(hand, ['c1']);
    expect(view.pick).toBe('partial');
    expect(view.canJoin('c2')).toBe(false);
    expect(view.canJoin('c3')).toBe(true);
    expect(view.canJoin('c4')).toBe(true);
    // A picked card can always be unpicked.
    expect(view.canJoin('c1')).toBe(true);
  });

  it('says whether three picked cards are a set', () => {
    expect(cardPickView(hand, ['c1', 'c3', 'c4']).pick).toBe('valid');
    const wrong = cardPickView(hand, ['c1', 'c2', 'c3']);
    expect(wrong.pick).toBe('invalid');
    expect(wrong.canJoin('c4')).toBe(false);
  });
});

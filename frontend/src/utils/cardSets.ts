/**
 * Territory-card sets, as the server judges them. These mirror
 * backend/src/game-engine/state/gameStateManager.ts (`isValidCardSet`,
 * `findRedeemableCardIds`) and backend/src/game-engine/combat/combatResolver.ts
 * (`getCardSetBonus`) so the HUD can offer a trade only when the server would
 * accept it, and name the bonus it would pay. The server stays authoritative:
 * a redemption it refuses is refused, whatever the client offered.
 */

export interface HandCard {
  card_id: string;
  symbol: string;
}

/** Three of a kind, one of each, or any pair plus a wild. */
export function isValidCardSet(symbols: string[]): boolean {
  const nonWild = symbols.filter((s) => s !== 'wild');
  const uniqueNonWild = new Set(nonWild);
  if (uniqueNonWild.size === 1) return true;
  if (uniqueNonWild.size === 3) return true;
  if (symbols.includes('wild') && uniqueNonWild.size <= 2) return true;
  return false;
}

/** First valid 3-card set: cards sorted by `card_id`, combinations tried in stable index order. */
export function findRedeemableCardIds(cards: HandCard[]): string[] | null {
  if (cards.length < 3) return null;
  const sorted = [...cards].sort((a, b) => a.card_id.localeCompare(b.card_id));
  const n = sorted.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        if (isValidCardSet([sorted[i].symbol, sorted[j].symbol, sorted[k].symbol])) {
          return [sorted[i].card_id, sorted[j].card_id, sorted[k].card_id];
        }
      }
    }
  }
  return null;
}

/**
 * Units the next set pays: 4, 6, 8, 10, 12, 15, then +5 a set, clamped to `cap`
 * when it is positive. The count is shared by every player in the game, so a
 * bot's trade raises the human's next one.
 */
export function cardSetBonus(redemptionCount: number, cap?: number): number {
  const schedule = [4, 6, 8, 10, 12, 15];
  const bonus = redemptionCount < schedule.length
    ? schedule[redemptionCount]
    : 15 + (redemptionCount - schedule.length + 1) * 5;
  return cap && cap > 0 ? Math.min(bonus, cap) : bonus;
}

/** Every valid 3-card set in a hand, each as its card ids in hand order. */
export function validSetsInHand(cards: HandCard[]): string[][] {
  const sets: string[][] = [];
  const n = cards.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        if (isValidCardSet([cards[i].symbol, cards[j].symbol, cards[k].symbol])) {
          sets.push([cards[i].card_id, cards[j].card_id, cards[k].card_id]);
        }
      }
    }
  }
  return sets;
}

/** The rule for a set, in the words the cards UI uses. */
export const CARD_SET_RULE = 'Three of a kind, one of each, or a pair plus a wild.';

export interface CardPickView {
  /** Cards that belong to at least one valid set in the hand. */
  inSet: Set<string>;
  /** Whether a card can be picked toward a set with the cards already picked. */
  canJoin: (cardId: string) => boolean;
  /** What the pick so far is: nothing, part of a pick, a set, or three that are not one. */
  pick: 'none' | 'partial' | 'valid' | 'invalid';
  /** The set a one-tap trade redeems: the server's own first choice, as the bots trade. */
  firstSet: string[] | null;
}

/**
 * What the cards UI shows for a hand and a pick (card_sets_explain_enabled):
 * the cards that make a set, which cards could still complete the pick, and
 * whether three picked cards are a set the server will take.
 */
export function cardPickView(cards: HandCard[], selected: string[]): CardPickView {
  const sets = validSetsInHand(cards);
  const inSet = new Set(sets.flat());
  const picked = selected.filter((id) => cards.some((c) => c.card_id === id));
  const symbolOf = (id: string) => cards.find((c) => c.card_id === id)?.symbol ?? '';
  const pick: CardPickView['pick'] =
    picked.length === 0
      ? 'none'
      : picked.length < 3
        ? 'partial'
        : isValidCardSet(picked.map(symbolOf))
          ? 'valid'
          : 'invalid';
  const canJoin = (cardId: string) =>
    picked.includes(cardId) ||
    (picked.length < 3 && sets.some((s) => s.includes(cardId) && picked.every((id) => s.includes(id))));
  return { inSet, canJoin, pick, firstSet: findRedeemableCardIds(cards) };
}

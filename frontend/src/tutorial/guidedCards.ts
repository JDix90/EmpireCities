/**
 * The tutorial's first three action cards, one step at a time
 * (`tutorial_guided_draft_enabled`): place reinforcements, attack, fortify.
 *
 * They are the first cards that ask the player to do something. Each asked
 * for several things in one paragraph, naming controls that are not on screen
 * until the first of them is done; each sat over the board it was describing
 * (two of the player's three territories on a phone); and the only thing on
 * any of them to press was Exit Tutorial.
 *
 * Guided, a card says only the next thing to do, worked out here from what the
 * player has done so far. The overlay shows it small and out of the board's
 * way, with one button that moves the player on and Exit as a link.
 */
import type { FirstAttackHint, FirstAttackOpen } from '../utils/firstAttackHint';

export type GuidedCard = 'draft' | 'attack' | 'fortify';

/** The tutorial step each guided card replaces the copy of. */
export const GUIDED_STEP_IDS: Record<GuidedCard, string> = {
  draft: 'draft_do',
  attack: 'choose_front',
  fortify: 'fortify_do',
};

/** What the card's one button does; the overlay words it. */
export type GuidedAction = 'placeForMe' | 'showMe' | 'endTurn';

export interface GuidedStep {
  card: GuidedCard;
  /** The stage within the card: the key of its line (`overlay.guided.<card>.<stage>`). */
  stage: string;
  /** One-based position and how many there are, for the progress dots. */
  number: number;
  total: number;
  /** Names the line mentions (a territory, the gold button's label). */
  vars: Record<string, string>;
  /** The button that moves the player on, where the stage has one. */
  action: GuidedAction | null;
}

/** The guided card a tutorial step is, if any. */
export function guidedCardFor(stepId: string | undefined): GuidedCard | null {
  const hit = (Object.keys(GUIDED_STEP_IDS) as GuidedCard[]).find((card) => GUIDED_STEP_IDS[card] === stepId);
  return hit ?? null;
}

/**
 * Placing reinforcements: pick a territory, place the units, press the gold
 * button. Nothing left to place means the gold button, whatever is selected.
 */
export function guidedDraftStep(input: {
  unitsRemaining: number;
  /** A territory the player owns is selected, so its panel is open. */
  ownTerritorySelected: boolean;
  advanceLabel: string;
}): GuidedStep {
  const base = { card: 'draft' as const, total: 3, vars: { button: input.advanceLabel } };
  if (input.unitsRemaining <= 0) return { ...base, stage: 'advance', number: 3, action: null };
  return input.ownTerritorySelected
    ? { ...base, stage: 'place', number: 2, action: 'placeForMe' }
    : { ...base, stage: 'pick', number: 1, action: 'placeForMe' };
}

/**
 * Attacking: one attack is named, the one the first match's coach would name
 * (utils/firstAttackHint.ts). Tap its source, then its target, then, once an
 * attack has been made, attack again or press the gold button.
 *
 * Null when there is no attack to name and none has been made: the long card
 * then stands, since it describes what to look for.
 */
export function guidedAttackStep(input: {
  hint: FirstAttackHint | null;
  open: FirstAttackOpen;
  attackedThisTurn: boolean;
  advanceLabel: string;
}): GuidedStep | null {
  const base = { card: 'attack' as const, total: 3 };
  if (input.attackedThisTurn) {
    return { ...base, stage: 'advance', number: 3, vars: { button: input.advanceLabel }, action: null };
  }
  const hint = input.hint;
  if (!hint) return null;
  const vars = { from: hint.fromName, to: hint.toName };
  if (input.open === 'from') return { ...base, stage: 'target', number: 2, vars, action: null };
  if (input.open === 'to') return { ...base, stage: 'confirm', number: 2, vars, action: null };
  return { ...base, stage: 'source', number: 1, vars, action: 'showMe' };
}

/**
 * Fortifying is optional, so the card says so and offers the way on: move
 * units, or end the turn. Once a move is made, the gold button.
 */
export function guidedFortifyStep(input: { movesUsed: number; advanceLabel: string }): GuidedStep {
  const base = { card: 'fortify' as const, total: 2, vars: { button: input.advanceLabel } };
  return input.movesUsed > 0
    ? { ...base, stage: 'advance', number: 2, action: null }
    : { ...base, stage: 'choose', number: 1, action: 'endTurn' };
}

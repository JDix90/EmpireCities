import type { TutorialStep } from './types';

/** The copy a card shows, after the layout and the skip path have had their say. */
export interface CardCopy {
  title: string;
  message: string;
  detail?: string;
  hint?: string;
}

/**
 * What a card reads: the phone copy where the game is in its phone layout and
 * the step has some, and the skip copy on a step reached by "Skip to the end"
 * (which wins: a skipped wrap-up has no play to point the player at).
 */
export function cardCopy(step: TutorialStep, { phone, skipped }: { phone: boolean; skipped: boolean }): CardCopy {
  return {
    title: skipped && step.skippedTitle ? step.skippedTitle : step.title,
    message: skipped && step.skippedMessage
      ? step.skippedMessage
      : (phone && step.messagePhone) || step.message,
    detail: (phone && step.detailPhone) || step.detail,
    hint: (phone && step.hintPhone) || step.hint,
  };
}

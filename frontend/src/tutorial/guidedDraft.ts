/**
 * The tutorial's reinforcement card, one step at a time
 * (`tutorial_guided_draft_enabled`).
 *
 * It is the first card that asks the player to do something. It asked for four
 * things in one sentence, naming controls that are not on screen until the
 * first of them is done; it sat over the player's own territories (two of the
 * three on a phone); and the only thing on it to press was Exit Tutorial.
 *
 * Guided, the card says only the next thing to do, worked out here from what
 * the player has done so far.
 */
export type GuidedDraftStage = 'pick' | 'place' | 'advance';

export const GUIDED_DRAFT_STAGES: readonly GuidedDraftStage[] = ['pick', 'place', 'advance'];

/** The step id the guided card replaces the copy of. */
export const GUIDED_DRAFT_STEP_ID = 'draft_do';

/**
 * Which of the three the player is on: nothing left to place means the gold
 * button, whatever is selected; otherwise a territory of their own open means
 * the stepper in its panel; otherwise picking one.
 */
export function guidedDraftStage(input: {
  /** Reinforcements still in the pool. */
  unitsRemaining: number;
  /** A territory the player owns is selected, so its panel is open. */
  ownTerritorySelected: boolean;
}): GuidedDraftStage {
  if (input.unitsRemaining <= 0) return 'advance';
  return input.ownTerritorySelected ? 'place' : 'pick';
}

/** One-based position of a stage, for "2 of 3". */
export function guidedDraftStageNumber(stage: GuidedDraftStage): number {
  return GUIDED_DRAFT_STAGES.indexOf(stage) + 1;
}

/** Whether a step is the one the guided card applies to: the flag on, and that step current. */
export function isGuidedDraftStep(input: { enabled: boolean; isTutorial: boolean; stepId: string | undefined }): boolean {
  return input.enabled && input.isTutorial && input.stepId === GUIDED_DRAFT_STEP_ID;
}

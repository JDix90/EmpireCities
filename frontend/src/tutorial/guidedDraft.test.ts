import { describe, expect, it } from 'vitest';
import { guidedDraftStage, guidedDraftStageNumber, isGuidedDraftStep, GUIDED_DRAFT_STEP_ID } from './guidedDraft';
import { COMBINED_CORE_TUTORIAL_STEPS } from './modules/combinedCoreSteps';

describe('guidedDraftStage', () => {
  it('starts by asking for a territory', () => {
    expect(guidedDraftStage({ unitsRemaining: 4, ownTerritorySelected: false })).toBe('pick');
  });

  it('names the panel\'s controls once a territory of the player\'s own is open', () => {
    expect(guidedDraftStage({ unitsRemaining: 4, ownTerritorySelected: true })).toBe('place');
    // Some placed, some left, and the panel closed again: back to picking.
    expect(guidedDraftStage({ unitsRemaining: 1, ownTerritorySelected: false })).toBe('pick');
  });

  it('points at the gold button once nothing is left to place, whatever is selected', () => {
    expect(guidedDraftStage({ unitsRemaining: 0, ownTerritorySelected: true })).toBe('advance');
    expect(guidedDraftStage({ unitsRemaining: 0, ownTerritorySelected: false })).toBe('advance');
  });

  it('numbers the stages one to three', () => {
    expect((['pick', 'place', 'advance'] as const).map(guidedDraftStageNumber)).toEqual([1, 2, 3]);
  });
});

describe('isGuidedDraftStep', () => {
  it('applies to the reinforcement card of a tutorial, with the flag on', () => {
    expect(isGuidedDraftStep({ enabled: true, isTutorial: true, stepId: GUIDED_DRAFT_STEP_ID })).toBe(true);
    expect(isGuidedDraftStep({ enabled: false, isTutorial: true, stepId: GUIDED_DRAFT_STEP_ID })).toBe(false);
    expect(isGuidedDraftStep({ enabled: true, isTutorial: false, stepId: GUIDED_DRAFT_STEP_ID })).toBe(false);
    expect(isGuidedDraftStep({ enabled: true, isTutorial: true, stepId: 'choose_front' })).toBe(false);
    expect(isGuidedDraftStep({ enabled: true, isTutorial: true, stepId: undefined })).toBe(false);
  });

  it('names a step the core tutorial still has, waiting on the phase ending', () => {
    const step = COMBINED_CORE_TUTORIAL_STEPS.find((s) => s.id === GUIDED_DRAFT_STEP_ID);
    expect(step?.requireAction).toBe('end_phase');
  });
});

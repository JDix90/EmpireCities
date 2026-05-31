import { describe, expect, it, beforeEach } from 'vitest';
import {
  getTutorialSteps,
  shouldAdvanceTutorialOnState,
  isTutorialStepCentered,
  markTutorialModuleComplete,
  getCompletedTutorialModules,
} from './progression';

describe('tutorial progression', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns core steps by default', () => {
    const steps = getTutorialSteps('core');
    expect(steps[0]?.id).toBe('welcome');
    expect(steps.some((s) => s.id === 'wrapup')).toBe(true);
  });

  it('returns module-specific step lists', () => {
    expect(getTutorialSteps('tech_tree')[0]?.id).toBe('tt_welcome');
    expect(getTutorialSteps('faction_ability').some((s) => s.requireAction === 'ability_used')).toBe(true);
  });

  it('persists module completion in localStorage', () => {
    markTutorialModuleComplete('advanced_settings');
    expect(getCompletedTutorialModules()).toContain('advanced_settings');
  });

  it('advances on draft completion', () => {
    const step = getTutorialSteps('core').find((s) => s.id === 'draft_do');
    expect(
      shouldAdvanceTutorialOnState({
        step,
        prevPhase: 'draft',
        nextPhase: 'attack',
        playerChanged: false,
        prevPlayerIndex: 0,
        newPlayerIndex: 0,
        myPlayerId: 'u1',
        players: [{ player_id: 'u1' }, { player_id: 'ai_1' }],
        isMyDraftTurn: true,
        draftLeft: 0,
      }),
    ).toBe(true);
  });

  it('marks primer steps as centered', () => {
    const step = getTutorialSteps('core').find((s) => s.id === 'ability_primer');
    expect(isTutorialStepCentered(step)).toBe(true);
  });
});

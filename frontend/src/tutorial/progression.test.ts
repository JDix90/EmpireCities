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

  it('advances the draft card when the player leaves the draft phase', () => {
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

  it('satisfies the my_turn gate whenever it is the viewer\'s turn', () => {
    // Not just on the transition into it. Cards wait on phase changes and there
    // are only three per turn, so a my_turn card routinely becomes current after
    // the transition has already fired — it used to sit there telling the player
    // to watch an opponent who was not playing.
    const step = getTutorialSteps('core').find((s) => s.id === 'turn_ends');
    const base = {
      step,
      prevPhase: 'draft',
      nextPhase: 'draft',
      playerChanged: false,
      prevPlayerIndex: 0,
      newPlayerIndex: 0,
      myPlayerId: 'u1',
      players: [{ player_id: 'u1' }, { player_id: 'ai_1' }],
      isMyDraftTurn: true,
      draftLeft: 3,
    };
    expect(shouldAdvanceTutorialOnState(base)).toBe(true);
  });

  it('does not satisfy my_turn while the opponent is playing', () => {
    const step = getTutorialSteps('core').find((s) => s.id === 'turn_ends');
    expect(
      shouldAdvanceTutorialOnState({
        step,
        prevPhase: 'fortify',
        nextPhase: 'draft',
        playerChanged: true,
        prevPlayerIndex: 0,
        newPlayerIndex: 1,
        myPlayerId: 'u1',
        players: [{ player_id: 'u1' }, { player_id: 'ai_1' }],
        isMyDraftTurn: false,
        draftLeft: -1,
      }),
    ).toBe(false);
  });

  it('marks read-heavy cards as centered', () => {
    const step = getTutorialSteps('core').find((s) => s.id === 'economy_intro');
    expect(isTutorialStepCentered(step)).toBe(true);
  });
});

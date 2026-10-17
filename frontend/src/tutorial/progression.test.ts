import { describe, expect, it, beforeEach } from 'vitest';
import {
  getTutorialSteps,
  shouldAdvanceTutorialOnState,
  isTutorialGateAlreadyMet,
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

  it('keeps a galaxy lesson\'s completion and drops ids no lesson has', () => {
    localStorage.setItem(
      'borderfall_tutorial_modules_completed_v2',
      JSON.stringify(['core', 'galaxy_lane_sovereignty', 'galaxy_everything']),
    );
    expect(getCompletedTutorialModules()).toEqual(['core', 'galaxy_lane_sovereignty']);
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

  describe('research and advances made before their card', () => {
    // The Tech Tree opens from the sidebar on any card, and its own events only
    // count while the waiting card is current. A lesson grants about what its
    // research costs, so spending it early left nothing to research with.
    const core = (id: string) => getTutorialSteps('core').find((s) => s.id === id);

    it('lets a research card pass once a technology is already researched', () => {
      expect(isTutorialGateAlreadyMet({ step: core('ea_research'), ownTechCount: 0, ownAtFinalEra: false })).toBe(false);
      expect(isTutorialGateAlreadyMet({ step: core('ea_research'), ownTechCount: 2, ownAtFinalEra: false })).toBe(true);
      const tt = getTutorialSteps('tech_tree').find((s) => s.id === 'tt_research');
      expect(isTutorialGateAlreadyMet({ step: tt, ownTechCount: 1, ownAtFinalEra: false })).toBe(true);
    });

    it('lets the research and advance cards pass once the last era is reached', () => {
      // Advancing clears the tree, so the research count reads 0 again.
      for (const id of ['ea_research', 'ea_advance']) {
        expect(isTutorialGateAlreadyMet({ step: core(id), ownTechCount: 0, ownAtFinalEra: true }), id).toBe(true);
      }
      expect(isTutorialGateAlreadyMet({ step: core('ea_advance'), ownTechCount: 2, ownAtFinalEra: false })).toBe(false);
    });

    it('leaves every other card to its own gate', () => {
      for (const id of ['draft_do', 'turn_ends', 'economy_intro', 'wrapup']) {
        expect(isTutorialGateAlreadyMet({ step: core(id), ownTechCount: 3, ownAtFinalEra: true }), id).toBe(false);
      }
    });
  });

  it('marks read-heavy cards as centered', () => {
    const step = getTutorialSteps('core').find((s) => s.id === 'economy_intro');
    expect(isTutorialStepCentered(step)).toBe(true);
  });
});

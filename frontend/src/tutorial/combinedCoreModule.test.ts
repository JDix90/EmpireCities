import { describe, expect, it } from 'vitest';
import {
  COMBINED_CORE_TUTORIAL_STEPS,
  COMBINED_CORE_STEP_IDS,
} from './modules/combinedCoreSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

describe('core tutorial', () => {
  const byId = (id: string) => COMBINED_CORE_TUTORIAL_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''}`;
  };

  it('ships the step list it means to, in order', () => {
    expect(COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.id)).toEqual([...COMBINED_CORE_STEP_IDS]);
  });

  it('has unique step ids', () => {
    const ids = COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is what the core module resolves to', () => {
    expect(getTutorialSteps('core')).toBe(COMBINED_CORE_TUTORIAL_STEPS);
  });

  it('fits a first session — eight cards, not fifteen', () => {
    // The point of the rewrite. A regression here means preview cards crept
    // back in; add them to a deep-dive module instead.
    expect(COMBINED_CORE_TUTORIAL_STEPS.length).toBeLessThanOrEqual(8);
  });

  it('only uses gates the game actually advances on', () => {
    for (const step of COMBINED_CORE_TUTORIAL_STEPS) {
      if (!step.requireAction) continue;
      expect(isActionOnlyRequireAction(step.requireAction)).toBe(true);
    }
  });

  it('teaches the era climb by playing it, not by previewing it', () => {
    const gates = COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.requireAction).filter(Boolean);
    expect(gates).toContain('tech_researched');
    expect(gates).toContain('era_advanced');
    // The preview cards this list exists to replace.
    const ids = COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.id);
    for (const dropped of [
      'advanced_settings_primer',
      'ability_primer',
      'tech_primer',
      'settings_overview',
      'cards_explain',
    ]) {
      expect(ids).not.toContain(dropped);
    }
  });

  it('leaves the draft card holding the phase transition, not the pool', () => {
    // `draft` is satisfied the moment the pool empties, which would leave the
    // NEXT card waiting on a phase change the player then makes without having
    // attacked — the attack card would be eaten by the draft→attack transition.
    expect(byId('draft_do')?.requireAction).toBe('end_phase');
    expect(text('draft_do')).toContain(phaseAdvanceLabel('draft'));
  });

  it('references the shared phase-advance labels', () => {
    // Drift guard: desktop and mobile previously used different labels
    // ("Begin Attack Phase →" vs "End Draft") and the tutorial named only the
    // desktop one, stranding phone players hunting for a button that wasn't
    // on their screen.
    expect(text('choose_front')).toContain(phaseAdvanceLabel('attack'));
    expect(text('turn_ends')).toContain(phaseAdvanceLabel('fortify'));
  });

  it('never references a sidebar location as the only guidance', () => {
    for (const step of COMBINED_CORE_TUTORIAL_STEPS) {
      const t = `${step.message} ${step.hint ?? ''}`;
      expect(t).not.toMatch(/right-hand sidebar/);
      expect(t).not.toMatch(/sidebar on the right/);
    }
  });

  it('tells the draft step which color is the player', () => {
    expect(text('draft_do')).toContain('{playerColor}');
  });

  it('poses the first attack as a choice between two named fronts', () => {
    // Each western territory borders exactly one eastern one
    // (tutorialScript.ts), so a target named without its source is only
    // actionable from one place. Naming both fronts turns that constraint into
    // the lesson instead of a hint that reads wrong from two of three clicks.
    const t = text('choose_front');
    expect(t).toContain('Western Plains');
    expect(t).toContain('Eastern Forest');
    expect(t).toContain('Northern Hills');
    expect(t).toContain('Desert Outpost');
  });

  it('docks the attack card clear of the board it is pointing at', () => {
    // Bottom-centre lands on the middle and southern eastern territories this
    // card tells the player to click. See `cardPosition` in ./types.
    expect(byId('choose_front')?.cardPosition).toBe('aside');
    expect(isTutorialStepCentered(byId('choose_front'))).toBe(false);
  });

  it('ends on a wrapup card that still explains how to win', () => {
    const last = COMBINED_CORE_TUTORIAL_STEPS[COMBINED_CORE_TUTORIAL_STEPS.length - 1];
    expect(last.variant).toBe('wrapup');
    // `victory_explain` is dropped as its own card; its content must survive.
    expect(last.message.toLowerCase()).toContain('domination');
  });

  it('names what the island left out rather than previewing it card by card', () => {
    const last = COMBINED_CORE_TUTORIAL_STEPS[COMBINED_CORE_TUTORIAL_STEPS.length - 1];
    const detail = (last.detail ?? '').toLowerCase();
    for (const omitted of ['cards', 'factions', 'fog of war']) {
      expect(detail).toContain(omitted);
    }
    // The tutorial gate is softer than a real game's; say so instead of letting
    // the player infer that two tier-1 techs is the whole system.
    expect(detail).toContain('buildings');
  });

  it('has honest wrap-up copy for the skip path', () => {
    // "Skip to the end" lands on this card at turn 1 with nothing placed. The
    // earned copy recaps a session; the skip copy must not.
    const last = COMBINED_CORE_TUTORIAL_STEPS[COMBINED_CORE_TUTORIAL_STEPS.length - 1];
    expect(last.skippedTitle).toBeTruthy();
    expect(last.skippedMessage).toBeTruthy();
    const skipped = last.skippedMessage!.toLowerCase();
    expect(skipped).not.toMatch(/you ran|you climbed|climbed an era/);
    expect(skipped).toContain('domination'); // still explains how to win
    expect(skipped).toMatch(/reinforcements|blue territory/); // and what to do right now
  });

  it('lays out its read-heavy cards centered', () => {
    const centered = COMBINED_CORE_TUTORIAL_STEPS.filter((s) => isTutorialStepCentered(s)).map((s) => s.id);
    expect(centered).toContain('economy_intro');
    expect(centered).toContain('welcome');
  });

  it('keeps every action step ahead of the wrapup', () => {
    const lastGate = COMBINED_CORE_TUTORIAL_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBeLessThan(COMBINED_CORE_TUTORIAL_STEPS.length - 1);
  });
});

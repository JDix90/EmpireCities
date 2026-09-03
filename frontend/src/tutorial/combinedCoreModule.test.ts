import { describe, expect, it } from 'vitest';
import {
  COMBINED_CORE_TUTORIAL_STEPS,
  COMBINED_CORE_STEP_IDS,
} from './modules/combinedCoreSteps';
import { CORE_TUTORIAL_STEPS } from './modules/coreSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';

describe('combined core tutorial', () => {
  it('borrows every step it means to', () => {
    // `borrow` silently drops a step whose source id no longer exists, so the
    // renamed step would just vanish from a first-time player's tutorial. This
    // assertion is what turns that into a CI failure.
    expect(COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.id)).toEqual([...COMBINED_CORE_STEP_IDS]);
  });

  it('has unique step ids', () => {
    const ids = COMBINED_CORE_TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is selected only when the game was created as the combined tutorial', () => {
    expect(getTutorialSteps('core', { combined: true })).toBe(COMBINED_CORE_TUTORIAL_STEPS);
    expect(getTutorialSteps('core')).toBe(CORE_TUTORIAL_STEPS);
    expect(getTutorialSteps('core', { combined: false })).toBe(CORE_TUTORIAL_STEPS);
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
    for (const dropped of ['advanced_settings_primer', 'ability_primer', 'tech_primer', 'settings_overview']) {
      expect(ids).not.toContain(dropped);
    }
  });

  it('ends on a wrapup card that still explains how to win', () => {
    const last = COMBINED_CORE_TUTORIAL_STEPS[COMBINED_CORE_TUTORIAL_STEPS.length - 1];
    expect(last.variant).toBe('wrapup');
    // `victory_explain` is dropped as its own card; its content must survive.
    expect(last.message.toLowerCase()).toContain('domination');
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

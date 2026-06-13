import { describe, it, expect, beforeEach } from 'vitest';
import { ERA_ADVANCEMENT_STEPS } from './modules/eraAdvancementSteps';
import {
  getTutorialSteps,
  getRecommendedTutorialModule,
  isActionOnlyRequireAction,
} from './progression';
import { TUTORIAL_MODULES } from './types';

describe('era advancement tutorial module', () => {
  it('is registered in the module catalogue and progression', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'era_advancement');
    expect(meta).toBeDefined();
    expect(meta?.title.length).toBeGreaterThan(0);
    expect(meta?.estimatedMinutes).toBeGreaterThan(0);
    expect(getTutorialSteps('era_advancement')).toBe(ERA_ADVANCEMENT_STEPS);
  });

  it('defines well-formed steps gated on the right actions', () => {
    for (const step of ERA_ADVANCEMENT_STEPS) {
      expect(step.id, JSON.stringify(step)).toMatch(/^ea_/);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.message.length).toBeGreaterThan(0);
    }
    const openTree = ERA_ADVANCEMENT_STEPS.find((s) => s.id === 'ea_open_tree');
    expect(openTree?.actionOpenTechTree).toBe(true);
    expect(openTree?.requireAction).toBe('tech_tree_opened');

    expect(ERA_ADVANCEMENT_STEPS.find((s) => s.id === 'ea_research')?.requireAction).toBe('tech_researched');
    expect(ERA_ADVANCEMENT_STEPS.find((s) => s.id === 'ea_advance')?.requireAction).toBe('era_advanced');

    const completes = ERA_ADVANCEMENT_STEPS.filter((s) => s.variant === 'module_complete');
    expect(completes).toHaveLength(1);
    expect(completes[0].id).toBe('ea_complete');
  });

  it('treats era_advanced as an action-only requirement', () => {
    expect(isActionOnlyRequireAction('era_advanced')).toBe(true);
  });

  it('recommends era_advancement once the earlier modules are done', () => {
    localStorage.setItem(
      'borderfall_tutorial_modules_completed_v2',
      JSON.stringify(['core', 'advanced_settings', 'faction_ability', 'tech_tree']),
    );
    expect(getRecommendedTutorialModule()).toBe('era_advancement');
  });
});

describe('progression localStorage isolation', () => {
  beforeEach(() => localStorage.clear());
  it('recommends the first incomplete module by default', () => {
    expect(getRecommendedTutorialModule()).toBe('advanced_settings');
  });
});

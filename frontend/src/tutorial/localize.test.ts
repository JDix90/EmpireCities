import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({ api: { post: vi.fn(() => Promise.resolve()), get: vi.fn() } }));

import { getTutorialSteps } from './progression';
import { TUTORIAL_MODULES } from './types';
import {
  TUTORIAL_STEP_LISTS,
  localizeTutorialModuleMeta,
  localizeTutorialStep,
  tutorialSourceText,
  tutorialTranslationKeys,
  type TranslateFn,
} from './localize';
import { phaseAdvanceLabel } from '../constants/phaseLabels';
import { i18n, loadLocale } from '../i18n';

const echo: TranslateFn = (key, opts) => `${key}|${opts.defaultValue}`;
const identity: TranslateFn = (_key, opts) => opts.defaultValue;

describe('tutorial copy keys', () => {
  it('TUTORIAL_STEP_LISTS is the same list getTutorialSteps hands the game, per lesson', () => {
    for (const meta of TUTORIAL_MODULES) expect(TUTORIAL_STEP_LISTS[meta.id]).toBe(getTutorialSteps(meta.id));
  });

  it('are scoped by lesson, so a step id reused with different copy does not collide', () => {
    const keys = tutorialTranslationKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('steps.core.ea_research.message');
    expect(keys).toContain('steps.era_advancement.ea_research.message');
    expect(tutorialSourceText('steps.core.ea_research.message')).not.toBe(
      tutorialSourceText('steps.era_advancement.ea_research.message'),
    );
  });

  it('resolve back to the English in the code', () => {
    expect(tutorialSourceText('steps.core.welcome.title')).toBe('Welcome, Commander!');
    expect(tutorialSourceText('modules.core.title')).toBe('Core Tutorial');
    expect(tutorialSourceText('overlay.next')).toBeUndefined();
    expect(tutorialSourceText('steps.core.welcome.nope')).toBeUndefined();
    expect(tutorialSourceText('steps.core.no_such_step.title')).toBeUndefined();
  });
});

describe('localizeTutorialStep', () => {
  const draftDo = TUTORIAL_STEP_LISTS.core.find((s) => s.id === 'draft_do')!;

  it('asks t for each copy field with the English as the default and leaves the rest alone', () => {
    const out = localizeTutorialStep(draftDo, echo, 'core');
    expect(out.title).toBe(`steps.core.draft_do.title|${draftDo.title}`);
    expect(out.message).toBe(`steps.core.draft_do.message|${draftDo.message}`);
    expect(out.hint).toBe(`steps.core.draft_do.hint|${draftDo.hint}`);
    expect(out.detail).toBeUndefined();
    expect(out.requireAction).toBe(draftDo.requireAction);
    expect(out.id).toBe('draft_do');
  });

  it('is the identity when every translation is the default', () => {
    for (const step of TUTORIAL_STEP_LISTS.core) expect(localizeTutorialStep(step, identity, 'core')).toEqual(step);
  });

  it('interpolates the live phase-button label into a translation and keeps {playerColor} for the overlay', async () => {
    await loadLocale('es');
    const t: TranslateFn = (key, opts) => String(i18n.t(key, { ...opts, lng: 'es' }));
    const out = localizeTutorialStep(draftDo, t, 'core');
    expect(out.title).toBe('Coloca tus refuerzos');
    expect(out.message).toContain(phaseAdvanceLabel('draft'));
    expect(out.message).toContain('{playerColor}');
    expect(out.message).not.toContain('{{');
  });
});

describe('localizeTutorialModuleMeta', () => {
  it('keys module copy by lesson id', () => {
    const core = TUTORIAL_MODULES[0];
    const out = localizeTutorialModuleMeta(core, echo);
    expect(out.title).toBe(`modules.core.title|${core.title}`);
    expect(out.description).toBe(`modules.core.description|${core.description}`);
    expect(out.estimatedMinutes).toBe(core.estimatedMinutes);
  });
});

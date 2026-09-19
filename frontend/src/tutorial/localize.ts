/**
 * Tutorial copy in the active language.
 *
 * The English in the step definitions (modules/*.ts) and in TUTORIAL_MODULES
 * stays the source of truth: it is passed as i18next's `defaultValue`, so a
 * card with no translation yet — or a language whose bundle failed to load —
 * renders exactly what it rendered before localization existed. Translations
 * live in src/i18n/locales/<lang>/tutorial.json under
 * `steps.<lesson>.<stepId>.<field>` and `modules.<lesson>.<field>`;
 * localeBundles.test.ts fails when a shipped language is missing one.
 *
 * Keys are scoped by lesson because step ids repeat across lessons with
 * different copy (`ea_research` and `ea_advance` exist in both the core and
 * the era-advancement module).
 */
import { phaseAdvanceLabel } from '../constants/phaseLabels';
import type { TutorialLessonModule, TutorialModuleMeta, TutorialStep } from './types';
import { TUTORIAL_MODULES } from './types';
import { ADVANCED_SETTINGS_STEPS } from './modules/advancedSettingsSteps';
import { COMBINED_CORE_TUTORIAL_STEPS } from './modules/combinedCoreSteps';
import { ERA_ADVANCEMENT_STEPS } from './modules/eraAdvancementSteps';
import { FACTION_ABILITY_STEPS } from './modules/factionAbilitySteps';
import { TECH_TREE_STEPS } from './modules/techTreeSteps';

/** The subset of i18next's `t` these helpers need; a test can pass a stub. */
export type TranslateFn = (
  key: string,
  options: { ns?: string; defaultValue: string } & Record<string, unknown>,
) => string;

/** The copy fields a step can carry, in the order the card renders them. */
export const TUTORIAL_STEP_COPY_FIELDS = [
  'title',
  'message',
  'detail',
  'hint',
  'whyItMatters',
  'skippedTitle',
  'skippedMessage',
] as const;
export type TutorialStepCopyField = (typeof TUTORIAL_STEP_COPY_FIELDS)[number];

/**
 * Every lesson's step list. Mirrors `getTutorialSteps` in progression.ts
 * (localize.test.ts pins that) without importing it, so this module stays
 * free of the API client that progression.ts pulls in.
 */
export const TUTORIAL_STEP_LISTS: Record<TutorialLessonModule, readonly TutorialStep[]> = {
  core: COMBINED_CORE_TUTORIAL_STEPS,
  advanced_settings: ADVANCED_SETTINGS_STEPS,
  faction_ability: FACTION_ABILITY_STEPS,
  tech_tree: TECH_TREE_STEPS,
  era_advancement: ERA_ADVANCEMENT_STEPS,
};

/**
 * Values a translated card may interpolate. The gold phase-advance buttons
 * keep their English labels until the in-game HUD is localized, so a
 * translation writes `{{draftButton}}` and always names the button the player
 * can see, however that label is worded this week.
 */
export function tutorialInterpolation(): Record<string, string> {
  return {
    draftButton: phaseAdvanceLabel('draft'),
    attackButton: phaseAdvanceLabel('attack'),
    fortifyButton: phaseAdvanceLabel('fortify'),
  };
}

export function tutorialStepKey(
  lesson: TutorialLessonModule,
  stepId: string,
  field: TutorialStepCopyField,
): string {
  return `steps.${lesson}.${stepId}.${field}`;
}

/**
 * Every tutorial-namespace key a shipped language must translate beyond the
 * chrome in locales/en/tutorial.json: each module's name and description, and
 * one per copy field per step of every lesson. Drives the coverage test, so a
 * new card cannot ship untranslated by accident.
 */
export function tutorialTranslationKeys(): string[] {
  const keys: string[] = [];
  for (const meta of TUTORIAL_MODULES) {
    keys.push(`modules.${meta.id}.title`, `modules.${meta.id}.description`);
  }
  for (const lesson of Object.keys(TUTORIAL_STEP_LISTS) as TutorialLessonModule[]) {
    for (const step of TUTORIAL_STEP_LISTS[lesson]) {
      for (const field of TUTORIAL_STEP_COPY_FIELDS) {
        if (step[field] !== undefined) keys.push(tutorialStepKey(lesson, step.id, field));
      }
    }
  }
  return keys;
}

/** The English (source) text behind a step or module key, or undefined for any other key. */
export function tutorialSourceText(key: string): string | undefined {
  const step = key.match(/^steps\.([^.]+)\.([^.]+)\.([^.]+)$/);
  if (step) {
    const [, lesson, stepId, field] = step;
    if (!(TUTORIAL_STEP_COPY_FIELDS as readonly string[]).includes(field)) return undefined;
    const list = TUTORIAL_STEP_LISTS[lesson as TutorialLessonModule];
    return list?.find((s) => s.id === stepId)?.[field as TutorialStepCopyField];
  }
  const mod = key.match(/^modules\.([^.]+)\.(title|description)$/);
  if (mod) return TUTORIAL_MODULES.find((m) => m.id === mod[1])?.[mod[2] as 'title' | 'description'];
  return undefined;
}

/**
 * A step with its copy in the active language. Gates, actions and layout hints
 * pass through untouched — only what the player reads changes.
 */
export function localizeTutorialStep(
  step: TutorialStep,
  t: TranslateFn,
  lesson: TutorialLessonModule,
): TutorialStep {
  const values = tutorialInterpolation();
  const out: TutorialStep = { ...step };
  for (const field of TUTORIAL_STEP_COPY_FIELDS) {
    const english = step[field];
    if (english === undefined) continue;
    out[field] = t(tutorialStepKey(lesson, step.id, field), { ns: 'tutorial', defaultValue: english, ...values });
  }
  return out;
}

export function localizeTutorialModuleMeta(meta: TutorialModuleMeta, t: TranslateFn): TutorialModuleMeta {
  return {
    ...meta,
    title: t(`modules.${meta.id}.title`, { ns: 'tutorial', defaultValue: meta.title }),
    description: t(`modules.${meta.id}.description`, { ns: 'tutorial', defaultValue: meta.description }),
  };
}

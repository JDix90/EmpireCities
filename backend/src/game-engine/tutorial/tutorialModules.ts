/**
 * The tutorial lesson modules, in one place.
 *
 * The id list used to be written out three times — the settings normalizer,
 * the start route's request schema and the completion endpoint — and the
 * client keeps its own copy (frontend/src/tutorial/types.ts). A module added
 * to one list and not another starts fine and is then refused when the player
 * finishes it, so every backend reader takes the list from here.
 *
 * The Galactic Age modules are listed apart because they are dark-launched:
 * the start route refuses them while `galaxy_tutorial_enabled` is off, and the
 * client hides them behind the same flag.
 */

export const CORE_TUTORIAL_LESSON_MODULES = [
  'core',
  'advanced_settings',
  'faction_ability',
  'tech_tree',
  'era_advancement',
] as const;

/** One module per Galactic Age victory condition, plus the primer; grows per PR. */
export const GALAXY_TUTORIAL_LESSON_MODULES = [
  'galaxy_lane_sovereignty',
  'galaxy_transcendence',
  'galaxy_secret_missions',
] as const;

export const TUTORIAL_LESSON_MODULES = [
  ...CORE_TUTORIAL_LESSON_MODULES,
  ...GALAXY_TUTORIAL_LESSON_MODULES,
] as const;

export type TutorialLessonModule = (typeof TUTORIAL_LESSON_MODULES)[number];
export type GalaxyTutorialLessonModule = (typeof GALAXY_TUTORIAL_LESSON_MODULES)[number];

export function isTutorialLessonModule(v: unknown): v is TutorialLessonModule {
  return typeof v === 'string' && (TUTORIAL_LESSON_MODULES as readonly string[]).includes(v);
}

export function isGalaxyTutorialModule(v: unknown): v is GalaxyTutorialLessonModule {
  return typeof v === 'string' && (GALAXY_TUTORIAL_LESSON_MODULES as readonly string[]).includes(v);
}

import { describe, it, expect } from 'vitest';
import {
  CORE_TUTORIAL_LESSON_MODULES,
  GALAXY_TUTORIAL_LESSON_MODULES,
  TUTORIAL_LESSON_MODULES,
  isGalaxyTutorialModule,
  isTutorialLessonModule,
} from './tutorialModules';

describe('tutorial module registry', () => {
  it('lists every lesson once, the galaxy lessons after the core ones', () => {
    expect(new Set(TUTORIAL_LESSON_MODULES).size).toBe(TUTORIAL_LESSON_MODULES.length);
    expect(TUTORIAL_LESSON_MODULES.slice(0, CORE_TUTORIAL_LESSON_MODULES.length)).toEqual([...CORE_TUTORIAL_LESSON_MODULES]);
    for (const g of GALAXY_TUTORIAL_LESSON_MODULES) expect(g.startsWith('galaxy_')).toBe(true);
  });

  it('accepts every lesson id and nothing else', () => {
    for (const id of TUTORIAL_LESSON_MODULES) expect(isTutorialLessonModule(id)).toBe(true);
    expect(isTutorialLessonModule('galaxy')).toBe(false);
    expect(isTutorialLessonModule(undefined)).toBe(false);
    expect(isGalaxyTutorialModule('core')).toBe(false);
    expect(isGalaxyTutorialModule('galaxy_lane_sovereignty')).toBe(true);
  });
});

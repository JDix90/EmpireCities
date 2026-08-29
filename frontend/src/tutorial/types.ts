/** Tutorial system v2 — modular lessons with shared step model. */
export const TUTORIAL_VERSION = 2 as const;

/** Set `VITE_TUTORIAL_V2=0` to hide optional deep-dive modules (core primers stay on). */
export const TUTORIAL_V2_ENABLED =
  typeof import.meta.env.VITE_TUTORIAL_V2 === 'undefined' ||
  import.meta.env.VITE_TUTORIAL_V2 !== '0';

export type TutorialLessonModule =
  | 'core'
  | 'advanced_settings'
  | 'faction_ability'
  | 'tech_tree'
  | 'era_advancement';

export type TutorialRequireAction =
  | 'draft'
  | 'end_phase'
  | 'my_turn'
  | 'tech_researched'
  | 'ability_used'
  | 'settings_explored'
  | 'bonuses_opened'
  | 'tech_tree_opened'
  | 'era_advanced';

export type TutorialStepVariant = 'wrapup' | 'module_complete';

export interface TutorialStep {
  id: string;
  title: string;
  message: string;
  detail?: string;
  hint?: string;
  requireAction?: TutorialRequireAction;
  variant?: TutorialStepVariant;
  /** Opens tech tree modal when player taps secondary action */
  actionOpenTechTree?: boolean;
  /** Opens bonuses modal */
  actionOpenBonuses?: boolean;
  /** Opens the in-tutorial settings lab overlay */
  actionOpenSettingsLab?: boolean;
  /** Collapsible “why this matters” copy */
  whyItMatters?: string;
}

export interface TutorialModuleMeta {
  id: TutorialLessonModule;
  title: string;
  description: string;
  estimatedMinutes: number;
}

export const TUTORIAL_MODULES: TutorialModuleMeta[] = [
  {
    id: 'core',
    // Describes the combined core tutorial, which is what `combined_tutorial_enabled`
    // (on by default) ships. With the flag off this module is the classic WW2
    // lesson instead — shorter, and about cards rather than the era climb.
    title: 'Core Tutorial',
    description: 'Draft, attack, fortify, and your first era advance.',
    // ~4 min of reading across 15 cards (817 words) plus 8 interactive beats:
    // three turns of the loop, an opponent turn, three techs and the advance.
    // Provisional until real `game_finished.duration_ms` medians exist — but
    // measured, not the 6 min this claimed when it was a different lesson.
    estimatedMinutes: 9,
  },
  {
    id: 'advanced_settings',
    title: 'Advanced Settings',
    description: 'How optional rules change pacing and strategy.',
    estimatedMinutes: 4,
  },
  {
    id: 'faction_ability',
    title: 'Faction Abilities',
    description: 'Passive bonuses and once-per-turn or once-per-game powers.',
    estimatedMinutes: 5,
  },
  {
    id: 'tech_tree',
    title: 'Technology Tree',
    description: 'Research costs, prerequisites, and combat upgrades.',
    estimatedMinutes: 5,
  },
  {
    id: 'era_advancement',
    title: 'Era Advancement',
    description: 'Climb from Ancient to Medieval: clear the gate, advance, and ride out the vulnerability window.',
    estimatedMinutes: 5,
  },
];

/** Single source for the core tutorial's advertised length. */
export function tutorialModuleMinutes(id: TutorialLessonModule): number {
  return TUTORIAL_MODULES.find((m) => m.id === id)?.estimatedMinutes ?? 5;
}

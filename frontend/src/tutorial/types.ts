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
  /**
   * Where the coaching card sits on desktop.
   *
   * `auto` (default) is bottom-centre, which is centred on the VIEWPORT rather
   * than on the map area — so on a 1400×900 window it lands at x 492–940 / y
   * 462–820, squarely over the middle and southern territories of the tutorial
   * island. A step whose copy names one of those must set `aside`, which docks
   * the card into the top-left gutter clear of both the board's east half and
   * the territory panel. Measured: with `auto`, elementFromPoint on the target's
   * unit badge returns the card, not the canvas.
   */
  cardPosition?: 'auto' | 'aside';
  /** Opens tech tree modal when player taps secondary action */
  actionOpenTechTree?: boolean;
  /** Opens bonuses modal */
  actionOpenBonuses?: boolean;
  /** Opens the in-tutorial settings lab overlay */
  actionOpenSettingsLab?: boolean;
  /** Collapsible “why this matters” copy */
  whyItMatters?: string;
  /**
   * Copy shown instead of `title`/`message` when the player reached this step
   * via "Skip to the end" rather than by playing through. A wrap-up that
   * recaps what the player did must not recap a session that never happened.
   */
  skippedTitle?: string;
  skippedMessage?: string;
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
    title: 'Core Tutorial',
    description: 'Draft, attack, fortify, and your first era advance.',
    // ~2 min of reading across 8 cards plus 5 interactive beats: two turns of
    // the loop, an opponent turn, two techs and the advance. Provisional until
    // real `game_finished.duration_ms` medians exist.
    estimatedMinutes: 5,
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

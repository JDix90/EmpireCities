/** Set `VITE_TUTORIAL_V2=0` to hide optional deep-dive modules (core primers stay on). */
export const TUTORIAL_V2_ENABLED =
  typeof import.meta.env.VITE_TUTORIAL_V2 === 'undefined' ||
  import.meta.env.VITE_TUTORIAL_V2 !== '0';

/**
 * The lesson ids, in the order the Academy lists them. Mirrors the backend's
 * registry (backend/src/game-engine/tutorial/tutorialModules.ts): the start
 * route and the completion endpoint accept exactly these.
 */
export const CORE_TUTORIAL_MODULE_IDS = [
  'core',
  'advanced_settings',
  'faction_ability',
  'tech_tree',
  'era_advancement',
] as const;

/**
 * The Galactic Age track: the primer, then one lesson per galaxy victory
 * condition. Behind `galaxy_tutorial_enabled` (featureFlagsStore), on by
 * default with an admin kill switch: the Academy, the recommended-next logic
 * and the wrap-up links leave them out while it is off, and the server
 * refuses to start one.
 */
export const GALAXY_TUTORIAL_MODULE_IDS = [
  'galaxy_primer',
  'galaxy_lane_sovereignty',
  'galaxy_transcendence',
  'galaxy_secret_missions',
  'galaxy_capital',
  'galaxy_threshold',
  'galaxy_domination',
] as const;

export const TUTORIAL_MODULE_IDS = [...CORE_TUTORIAL_MODULE_IDS, ...GALAXY_TUTORIAL_MODULE_IDS] as const;

export type TutorialLessonModule = (typeof TUTORIAL_MODULE_IDS)[number];
export type GalaxyTutorialLessonModule = (typeof GALAXY_TUTORIAL_MODULE_IDS)[number];

export function isTutorialLessonModule(v: unknown): v is TutorialLessonModule {
  return typeof v === 'string' && (TUTORIAL_MODULE_IDS as readonly string[]).includes(v);
}

export function isGalaxyTutorialModule(v: unknown): v is GalaxyTutorialLessonModule {
  return typeof v === 'string' && (GALAXY_TUTORIAL_MODULE_IDS as readonly string[]).includes(v);
}

/**
 * What a card waits on. Every one of these is something the game actually
 * reports (see `isActionOnlyRequireAction`), so a card never waits on a thing
 * the player cannot do:
 *   - `territory_captured`: the player's own attack captured a territory — the
 *     step's `targetTerritoryId`, when it names one, else any;
 *   - `my_next_turn`: the turn came back round to the player (an edge, unlike
 *     `my_turn`, which is a state check and is satisfied throughout the
 *     player's own turn — see `isMyTurnGateSatisfied`);
 *   - `building_built`: the player raised any building that is not a wonder;
 *   - `wonder_built`: the player raised their era's wonder;
 *   - `galaxy_chart_opened`: the player opened the Galaxy chart;
 *   - `mission_complete`: the player's own secret mission reads complete on
 *     the board they can see (a capture mission with every named system held);
 *   - `game_won`: the game ended with the player among the winners.
 */
export type TutorialRequireAction =
  | 'draft'
  | 'end_phase'
  | 'my_turn'
  | 'my_next_turn'
  | 'tech_researched'
  | 'ability_used'
  | 'settings_explored'
  | 'bonuses_opened'
  | 'tech_tree_opened'
  | 'era_advanced'
  | 'territory_captured'
  | 'building_built'
  | 'wonder_built'
  | 'galaxy_chart_opened'
  | 'mission_complete'
  | 'game_won';

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
  /**
   * The system this card is about: highlighted on the board while it is the
   * player's turn, and, on a `territory_captured` card, the one capture that
   * satisfies the gate.
   */
  targetTerritoryId?: string;
  /**
   * Offer "Skip to the end" on this card. The core lesson's `welcome` card
   * always does; a deep dive opts in per card, since its last card must then
   * carry honest skip copy (`skippedTitle` / `skippedMessage`).
   */
  skippable?: boolean;
  /**
   * Another lesson this card points at, offered as a button that leaves this
   * game for that lesson (`onLaunchModule`). The Galactic Age lessons link
   * their welcome cards to the primer this way.
   */
  linkModule?: TutorialLessonModule;
}

export interface TutorialModuleMeta {
  id: TutorialLessonModule;
  title: string;
  description: string;
  estimatedMinutes: number;
  /** A Galactic Age lesson: listed and recommended only while `galaxy_tutorial_enabled` is on. */
  galaxy?: boolean;
  /**
   * The lesson's last beat is winning the match, so the game-over screen, not a
   * card, is where the player ends up: finishing the game as a winner records
   * the lesson as done.
   */
  completesOnVictory?: boolean;
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
  {
    id: 'galaxy_primer',
    title: 'Galactic Age: The Differences',
    description: 'Six cards on what the galaxy changes — lanes, gateways, world rules, boards and wins — on a real four-seat board, before the six lessons that each play one win.',
    // Six cards of reading and one click; nothing to win.
    estimatedMinutes: 4,
    galaxy: true,
  },
  {
    id: 'galaxy_lane_sovereignty',
    title: 'Galactic Age: Lane Sovereignty',
    description: 'Hyperspace lanes, gateways and corridors: take a fifth corridor across a lane and hold the network to win.',
    // Six cards of reading and four turns of play on the galaxy board: a
    // research, a draft, one lane crossing, then two held turns.
    estimatedMinutes: 7,
    galaxy: true,
    completesOnVictory: true,
  },
  {
    id: 'galaxy_transcendence',
    title: 'Galactic Age: Transcendence',
    description: 'The Space to Stars climb: clear the Space Age gate, arrive in the Galactic Age and raise the Hyperlane Anchor to win.',
    // Seven cards of reading and one long turn of play: five researches, two
    // builds, the advance and the wonder, then the win at the next round.
    estimatedMinutes: 7,
    galaxy: true,
    completesOnVictory: true,
  },
  {
    id: 'galaxy_secret_missions',
    title: 'Galactic Age: Secret Missions',
    description: 'What the galaxy does to missions and alliances: take the two Sol gateways your mission names, across their lanes, and win.',
    // Five cards of reading and one turn of play: two lane crossings, then
    // the win as round 2 opens.
    estimatedMinutes: 5,
    galaxy: true,
    completesOnVictory: true,
  },
  {
    id: 'galaxy_capital',
    title: 'Galactic Age: Capital Capture',
    description: 'Capitals sit on gateways here: hold Amazon Basin and take the Navigators\' capital across its lane to win.',
    // Four cards of reading and one turn of play: one lane crossing, then the
    // win as round 2 opens.
    estimatedMinutes: 4,
    galaxy: true,
    completesOnVictory: true,
  },
  {
    id: 'galaxy_threshold',
    title: 'Galactic Age: Territory Threshold',
    description: 'The galaxy counts every system, colonies included: you hold 38 of the 39 that 60% needs — take the 39th by ground and win.',
    // Four cards of reading and one turn of play: one ground attack, then
    // the win as round 2 opens.
    estimatedMinutes: 4,
    galaxy: true,
    completesOnVictory: true,
  },
  {
    id: 'galaxy_domination',
    title: 'Galactic Age: Domination',
    description: 'Domination here ends when the last rival falls, not the last system: take the Navigators\' last gateway and the game ends at once, colonies untouched.',
    // Four cards of reading and one attack: the game ends on the capture.
    estimatedMinutes: 3,
    galaxy: true,
    completesOnVictory: true,
  },
];

/** Single source for the core tutorial's advertised length. */
export function tutorialModuleMinutes(id: TutorialLessonModule): number {
  return TUTORIAL_MODULES.find((m) => m.id === id)?.estimatedMinutes ?? 5;
}

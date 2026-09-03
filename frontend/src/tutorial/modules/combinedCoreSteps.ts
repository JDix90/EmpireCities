import { APP_NAME } from '../../constants/brand';
import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';
import { CORE_TUTORIAL_STEPS } from './coreSteps';
import { ERA_ADVANCEMENT_STEPS } from './eraAdvancementSteps';

/**
 * The combined core tutorial: one continuous match on Tutorial Island that
 * teaches the three phases AND carries the player through researching a tech
 * and advancing an era.
 *
 * Why this replaces the back half of `CORE_TUTORIAL_STEPS`: steps 9–15 there are
 * preview cards for systems the WW2 practice match does not have switched on
 * (cards, factions, tech, advanced settings). A new player spent the last third
 * of their first session reading about features they could not touch, and the
 * one thing that makes Borderfall different from every other Risk clone —
 * climbing an era — was not in the first session at all. Here it is steps 9–14,
 * played rather than described.
 *
 * Both source lists stay untouched and still ship: the standalone
 * `era_advancement` lesson is unchanged, and turning `combined_tutorial_enabled`
 * off returns new tutorials to `CORE_TUTORIAL_STEPS` on the WW2 map.
 */

const CORE_BY_ID = new Map(CORE_TUTORIAL_STEPS.map((s) => [s.id, s]));
const ERA_BY_ID = new Map(ERA_ADVANCEMENT_STEPS.map((s) => [s.id, s]));

/**
 * Borrow a step from another module, overriding the copy this match needs.
 * Returns a 0- or 1-element array so a renamed source step drops one card
 * instead of white-screening a first-time player mid-tutorial; the unit test
 * pins the full id list, so the rename is caught in CI rather than in prod.
 */
function borrow(
  source: Map<string, TutorialStep>,
  id: string,
  overrides: Partial<TutorialStep> = {},
): TutorialStep[] {
  const base = source.get(id);
  return base ? [{ ...base, ...overrides }] : [];
}

export const COMBINED_CORE_TUTORIAL_STEPS: TutorialStep[] = [
  // ── The loop: identical beats to the classic core lesson, island copy ──────
  ...borrow(CORE_BY_ID, 'welcome', {
    message: `${APP_NAME} is a strategy game of territory control. Each turn has three phases: Draft → Attack → Fortify. You hold the Western Realm of this island; an opponent holds the East.`,
    hint: 'Played Risk before? You\'ll feel right at home — and this match adds the part Risk doesn\'t have. Click "Next", or "Skip to the end" to jump straight in.',
  }),
  ...borrow(CORE_BY_ID, 'draft_explain', {
    message: 'At the start of your turn you receive new units. The formula: 1 unit per 3 territories you hold (minimum 3), plus a bonus for controlling an entire realm — you hold all three territories of the Western Realm, so that bonus is already yours.',
    detail: 'Bigger maps have larger realms worth larger bonuses. Holding a whole region, not just a lot of territory, is what compounds.',
  }),
  ...borrow(CORE_BY_ID, 'draft_do'),
  ...borrow(CORE_BY_ID, 'advance_draft'),
  ...borrow(CORE_BY_ID, 'attack_explain'),
  ...borrow(CORE_BY_ID, 'attack_do', {
    message: 'Click one of your territories, then an adjacent enemy one to attack. The Eastern Forest is thinly held — a good first target, and it borders the rest of the East.',
    hint: `Attack as many times as you like. When you're done, click the gold **${phaseAdvanceLabel('attack')}** button to continue.`,
  }),
  ...borrow(CORE_BY_ID, 'fortify_explain'),
  ...borrow(CORE_BY_ID, 'opponent_turn'),

  // ── The wedge: the era climb, played ──────────────────────────────────────
  {
    id: 'economy_intro',
    title: 'Your Empire Is Also an Economy',
    message: 'Territory is only half the game. Your empire holds a **treasury** and a **research programme**, and both grow every turn you hold ground — visible in the Era panel in your sidebar.',
    detail: 'That panel shows the timeline of eras, where you sit on it, and the gate you must clear to advance. Your opponent climbs at their own pace.',
    whyItMatters: 'Conquest is how you win a map. Advancing an era is how you outgrow the opponent holding it — stronger units, a fresh tech tree, and a one-time signature reward.',
  },
  ...borrow(ERA_BY_ID, 'ea_open_tree', {
    hint: 'Tap "Open Tech Tree" below. You have been granted research points to spend.',
  }),
  ...borrow(ERA_BY_ID, 'ea_research'),
  ...borrow(ERA_BY_ID, 'ea_gate'),
  ...borrow(ERA_BY_ID, 'ea_advance'),
  ...borrow(ERA_BY_ID, 'ea_signature'),

  // ── Wrap-up: victory conditions folded in, then out into a real game ──────
  {
    id: 'wrapup',
    title: 'You\'re Ready!',
    message: 'You ran the full turn cycle — draft, attack, fortify — and climbed an era. That is the whole loop. The default way to win is domination: capture every territory. Hosts can also pick Threshold (a share of the map), Capital Conquest, or Secret Missions.',
    // The skip path: the player is still on turn 1 with reinforcements
    // unplaced, so give them the shape of the loop and their next click —
    // never a recap of play they didn't do.
    skippedTitle: 'Jumping Straight In',
    skippedMessage: 'Here is the shape of it: each turn you draft units, attack neighbouring territories with dice, then fortify. Research a tech and advance Ancient → Medieval along the way — that is the part Risk doesn\'t have. Win by domination: capture every territory. (Hosts can also pick Threshold, Capital Conquest, or Secret Missions.) Right now you have reinforcements to place — click any blue territory, then Begin Attack.',
    detail: 'Real matches add what this island left out: territory cards for bonus units, factions with unique powers, buildings and stability, fog of war, and the full Ancient → Modern spine instead of a two-era hop.',
    variant: 'wrapup',
  },
];

/** Step ids this list expects to borrow, in order — pinned by the unit test. */
export const COMBINED_CORE_STEP_IDS = [
  'welcome',
  'draft_explain',
  'draft_do',
  'advance_draft',
  'attack_explain',
  'attack_do',
  'fortify_explain',
  'opponent_turn',
  'economy_intro',
  'ea_open_tree',
  'ea_research',
  'ea_gate',
  'ea_advance',
  'ea_signature',
  'wrapup',
] as const;

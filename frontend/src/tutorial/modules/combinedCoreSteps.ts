import { APP_NAME } from '../../constants/brand';
import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * The core tutorial: one continuous match on Tutorial Island that teaches the
 * three phases AND carries the player through researching a technology and
 * advancing an era — the thing that makes Borderfall not a Risk clone.
 *
 * Eight cards, not fifteen. The list this replaces borrowed its steps from two
 * other modules and spent a third of a first session on preview cards for
 * systems the match did not have switched on (cards, factions, advanced
 * settings). Every card here is attached to something the player does on the
 * board in front of them; anything the island leaves out is named once, in the
 * wrap-up, instead of getting a card of its own.
 *
 * Gates, and why they are the ones they are (see `shouldAdvanceTutorialOnState`
 * — exactly one step advances per server state update, which the ordering here
 * depends on):
 *
 *   - `draft_do` waits on `end_phase`, not `draft`. `draft` is satisfied the
 *     moment the pool empties, which would leave the NEXT card waiting on a
 *     phase change the player then makes without having attacked — so the
 *     attack card would be consumed by the draft→attack transition. One card
 *     covering "place them, then press the gold button" removes the seam.
 *   - `choose_front` waits on the attack→fortify transition, and
 *     `turn_ends` on `my_turn`. `my_turn` is true while the player is still in
 *     their own fortify phase, but it is only re-evaluated on the *next* state
 *     update — by which time the turn has passed to the opponent — so the card
 *     survives to be read during the opponent's turn, which is what it is about.
 */
export const COMBINED_CORE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, Commander!',
    message: `${APP_NAME} is a strategy game of territory control. Each turn runs Draft → Attack → Fortify. You hold the three territories of the **Western Realm** on this island; an opponent holds the East.`,
    detail: 'Draft gives you 1 unit per 3 territories (minimum 3), plus a bonus for holding an entire realm — you hold all of the West, so that bonus is already yours.',
    hint: 'Played Risk before? You\'ll feel right at home — and this match adds the part Risk doesn\'t have. Click "Next", or "Skip to the end" to jump straight in.',
  },
  {
    id: 'draft_do',
    title: 'Place Your Reinforcements',
    // Describes the real interaction, which is two clicks per placement: the
    // territory opens a panel, and the units only land when Place is pressed.
    // "Click a territory to place reinforcements" read as one click, so players
    // clicked repeatedly and nothing moved.
    message: `Click one of your territories — shown in **{playerColor}** — then use **+1**, **+5** or **Place all**. When every unit is down, click the gold **${phaseAdvanceLabel('draft')}** button.`,
    hint: 'Where you stack them decides which front you can open next. The gold button is in the sidebar on desktop, in the bottom bar on phones.',
    requireAction: 'end_phase',
  },
  {
    id: 'choose_front',
    title: 'Pick Your Front',
    // Poses the trade-off rather than naming a target. Each western territory
    // borders exactly one eastern one (tutorialScript.ts), so the two viable
    // attacks are genuinely different openings, and the authored scenario
    // (combinedTutorialScenario.ts) is built to make both of them live.
    message: 'Click one of your territories (2+ units), then an adjacent enemy one. **Western Plains → Eastern Forest** is the cheap opening: the Forest holds 2 and is the East\'s hub, so taking it puts you next to everything. **Northern Hills → Desert Outpost** is the slower flank: 3 defenders, but it is quiet ground you can hold.',
    detail: 'Attacker rolls up to 3 dice, defender up to 2. Highest are compared pair by pair; the loser of each pair loses a unit and ties go to the defender. You capture a territory when its last defender falls.',
    hint: `Attack as often as you like — or not at all. When you're done, click the gold **${phaseAdvanceLabel('attack')}** button.`,
    // Bottom-centre runs 630px tall here and sits squarely on the eastern half
    // of the board this card is telling the player to click. See `cardPosition`
    // in ../types.
    cardPosition: 'aside',
    requireAction: 'end_phase',
  },
  {
    id: 'turn_ends',
    title: 'Fortify, Then Watch',
    message: `Fortify moves units once between connected territories — shore up the border you just made, or skip it. Either way, the gold **${phaseAdvanceLabel('fortify')}** button ends your turn.`,
    detail: 'Then the opponent plays: you\'ll see their dice, their captures, and the active player highlighted in the sidebar in real time.',
    requireAction: 'my_turn',
  },
  {
    id: 'economy_intro',
    title: 'Your Empire Is Also an Economy',
    message: 'Territory is only half the game. Your empire holds a **treasury** and a **research programme**, and both grow every turn you hold ground.',
    detail: 'The Era panel in your sidebar shows the timeline of eras, where you sit on it, and the gate you must clear to advance. Your opponent climbs at their own pace.',
    whyItMatters: 'Conquest is how you win a map. Advancing an era is how you outgrow the opponent holding it — stronger units, a fresh tech tree, and a one-time signature reward.',
  },
  {
    id: 'ea_research',
    title: 'Research Toward the Gate',
    message: 'Open the Tech Tree. The rail at the top shows the advancement gate; research a tier-1 technology and watch its chips update.',
    actionOpenTechTree: true,
    requireAction: 'tech_researched',
    hint: 'You have been granted enough research for two technologies — which is exactly what this island\'s gate wants. Pick whichever pair you like.',
  },
  {
    id: 'ea_advance',
    title: 'Advance to Medieval',
    message: 'One more technology and every gate chip turns green. Then hit **Advance Era** — the button appears right there in the tech tree\'s gate rail.',
    detail: 'Your units carry forward at reduced strength for one turn — the vulnerability window — and your research resets to a fresh, stronger Medieval tree. You keep an echo of your old bonuses and gain the era\'s signature reward.',
    hint: 'Short on a chip? The rail names what\'s missing, and the Advance button lights up the moment nothing is.',
    requireAction: 'era_advanced',
  },
  {
    id: 'wrapup',
    title: 'You\'re Ready!',
    message: 'You ran the full turn cycle — draft, attack, fortify — and climbed an era. That is the whole loop. The default way to win is domination: capture every territory. Hosts can also pick Threshold (a share of the map), Capital Conquest, or Secret Missions.',
    // The skip path: the player is still on turn 1 with reinforcements
    // unplaced, so give them the shape of the loop and their next click —
    // never a recap of play they didn't do.
    skippedTitle: 'Jumping Straight In',
    skippedMessage: 'Here is the shape of it: each turn you draft units, attack neighbouring territories with dice, then fortify. Research a tech and advance Ancient → Medieval along the way — that is the part Risk doesn\'t have. Win by domination: capture every territory. (Hosts can also pick Threshold, Capital Conquest, or Secret Missions.) Right now you have reinforcements to place — click any blue territory, then Begin Attack.',
    detail: 'Real matches add what this island left out: territory cards for bonus units, factions with unique powers, buildings and stability, fog of war, a stiffer advancement gate (more research plus buildings), and the full Ancient → Modern spine instead of a two-era hop.',
    variant: 'wrapup',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const COMBINED_CORE_STEP_IDS = [
  'welcome',
  'draft_do',
  'choose_front',
  'turn_ends',
  'economy_intro',
  'ea_research',
  'ea_advance',
  'wrapup',
] as const;

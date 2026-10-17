import { APP_NAME } from '../../constants/brand';
import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * The core tutorial: one continuous match on the Italian peninsula that teaches
 * the three phases AND carries the player through researching a technology and
 * advancing an era — the thing that makes Borderfall not a Risk clone.
 *
 * Nine cards, not fifteen. The list this replaces borrowed its steps from two
 * other modules and spent a third of a first session on preview cards for
 * systems the match did not have switched on (cards, factions, advanced
 * settings). Every card here is attached to something the player does on the
 * board in front of them; anything this board leaves out is named once, in the
 * wrap-up, instead of getting a card of its own.
 *
 * The economy beats (`economy_intro` → `ea_research` → `ea_advance`) sit on the
 * player's SECOND turn, in its reinforcement phase. That is deliberate: era
 * advancement is only legal in reinforcement or fortify (`isEraAdvancePhase`),
 * and reinforcement is the better of the two — advance there and the new era's
 * tier applies to that same turn's attacks, whereas advancing in fortify pays
 * the identical vulnerability window for a benefit that starts a turn later.
 * Teaching the climb from the top of a turn teaches the habit worth having.
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
 *   - `choose_front` waits on the attack→fortify transition and `fortify_do` on
 *     the fortify→opponent one, so `turn_ends` only becomes current once the
 *     turn has actually passed. `my_turn` is a STATE check, not an edge: it is
 *     true throughout the player's own fortify phase, so a single card covering
 *     "fortify, then watch" was satisfied by the player's own fortify MOVE —
 *     the very thing it invited them to make — and dealt the whole economy run
 *     during fortify. Splitting the card is what keeps `my_turn` honest.
 */
export const COMBINED_CORE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, Commander!',
    message: `${APP_NAME} is a strategy game of territory control. Each turn runs Reinforce → Attack → Fortify. You hold the three territories of the **Tyrrhenian Coast** — the western side of Italy; an opponent holds the **Adriatic Coast**.`,
    detail: 'Reinforcement gives you 1 unit per 3 territories (minimum 3), plus a bonus for holding a whole region — you hold all of the Tyrrhenian Coast, so that +1 is already yours.',
    hint: 'Played a territory-conquest board game before? You\'ll feel right at home — and this match adds the part those games don\'t have: climbing through the eras. Press "Next", or "Skip to the end" to jump straight in.',
  },
  {
    id: 'draft_do',
    title: 'Place Your Reinforcements',
    // Describes the real interaction: the territory opens a panel, the stepper
    // sets how many, and the units only land when Place is pressed. "Click a
    // territory to place reinforcements" read as one click, so players clicked
    // repeatedly and nothing moved.
    message: `Pick one of your territories — shown in **{playerColor}** — then dial how many with **−/+** (or **All**) and press **Place**. When every unit is down, press the gold **${phaseAdvanceLabel('draft')}** button.`,
    hint: 'Where you stack them decides which front you can open next. The gold button is in the sidebar.',
    hintPhone: 'Where you stack them decides which front you can open next. The gold button is in the bar along the bottom of the screen.',
    requireAction: 'end_phase',
  },
  {
    id: 'choose_front',
    title: 'Pick Your Front',
    // Poses the trade-off rather than naming a target. The fronts follow real
    // Italian borders (tutorialScript.ts), and the authored scenario
    // (combinedTutorialScenario.ts) prices them so more than one is live: the
    // centre is cheap and opens the board, the north is a fair fight, and the
    // south is the one that should look wrong.
    message: 'Pick one of your territories (2+ units), then an adjacent enemy one. **Tuscany & Latium → Umbria & Abruzzo** is the cheap opening: it holds 2 and borders both of the other Adriatic lands, so taking it puts you next to everything. **Lombardy & Piedmont → Veneto & Emilia** is the slower flank: 3 defenders across a broad northern front.',
    detail: 'Attacker rolls up to 3 dice, defender up to 2 — those are the base counts; faction abilities, technologies and events can add dice, and this Ancient board re-rolls the attacker\'s lowest die once. Highest are compared pair by pair; the loser of each pair loses a unit and ties go to the defender. You capture a territory when its last defender falls, and up to 3 of your surviving attackers move in on their own — no prompt, and one always stays behind.',
    hint: `Attack as often as you like — or not at all. When you're done, press the gold **${phaseAdvanceLabel('attack')}** button.`,
    // Bottom-centre runs 630px tall here and sits squarely on the eastern half
    // of the board this card is telling the player to click. See `cardPosition`
    // in ../types.
    cardPosition: 'aside',
    requireAction: 'end_phase',
  },
  {
    id: 'fortify_do',
    title: 'Fortify, Then End Your Turn',
    message: `Fortify moves units once between connected territories — shore up the border you just made, or skip it. Either way, the gold **${phaseAdvanceLabel('fortify')}** button hands the turn over.`,
    detail: 'One move per turn, and only between territories you own that are joined by a chain of your own ground.',
    requireAction: 'end_phase',
  },
  {
    id: 'turn_ends',
    title: 'The Opponent Moves',
    message: 'Their turn runs the same three phases, but this practice opponent only places its reinforcements — it never attacks. The sidebar names whoever is active; a fast AI may already be done by the time you read this.',
    messagePhone: 'Their turn runs the same three phases, but this practice opponent only places its reinforcements — it never attacks. The bar along the bottom names whoever is active; a fast AI may already be done by the time you read this.',
    detail: 'Nothing to do here — the next card arrives as soon as the turn is back with you.',
    requireAction: 'my_turn',
  },
  {
    id: 'economy_intro',
    title: 'Your Empire Is Also an Economy',
    message: 'Your turn again — and this time, before you attack. Territory is only half the game: your empire holds a **treasury** of gold and a **research programme** of technology points, and both grew while you held ground.',
    detail: 'The Era Advancement panel in your sidebar shows the timeline of eras and where you sit on it; expand it to see the gate you must clear to advance. This practice opponent stays in the Ancient era — real rivals climb at their own pace.',
    detailPhone: 'The Era Advancement panel under **☰ Menu** shows the timeline of eras and where you sit on it; expand it to see the gate you must clear to advance. This practice opponent stays in the Ancient era — real rivals climb at their own pace.',
    whyItMatters: 'Conquest is how you win a map. Advancing an era is how you outgrow the opponent holding it — stronger units, a fresh tech tree, and a one-time signature reward.',
    phoneBrief: true,
  },
  {
    id: 'ea_research',
    title: 'Research Toward the Gate',
    message: 'Open the Tech Tree. The rail at the top shows the advancement gate; research a tier-1 technology and watch its chips update.',
    actionOpenTechTree: true,
    requireAction: 'tech_researched',
    hint: 'You have been granted enough research for two tier-1 technologies — exactly what this board\'s gate wants. Pick any two from Tier 1; a tier-2 technology does not count toward it.',
  },
  {
    id: 'ea_advance',
    title: 'Advance to Medieval',
    message: 'When every gate chip is green, hit **Advance to Medieval Era** — the button appears right there in the tech tree\'s gate rail. One more tier-1 technology is all this board\'s gate still wants.',
    detail: 'Advancing consolidates your armies: about 30% of your units are removed for good, spread across your territories, and for one turn afterwards your defenders fight weaker — the vulnerability window. Your research resets to a fresh, stronger Medieval tree; you keep an echo of your old bonuses and gain the era\'s signature reward.',
    hint: 'Climbing in your reinforcement phase means the new era\'s strength applies to the attacks you make this turn. Short on a chip? The rail names what\'s missing, and the Advance button appears the moment nothing is.',
    requireAction: 'era_advanced',
    phoneBrief: true,
    arrivesFoldedOverPanel: true,
  },
  {
    id: 'wrapup',
    title: 'You\'re Ready!',
    message: 'You ran the full turn cycle — reinforce, attack, fortify — and climbed an era. That is the whole loop. This board is won by domination: capture every territory. A Quick Match is won sooner, by holding 65% of the map, and hosts can also pick Capital Capture or Secret Missions.',
    // The skip path: the player is still on turn 1 with reinforcements
    // unplaced, so give them the shape of the loop and their next click —
    // never a recap of play they didn't do.
    skippedTitle: 'Jumping Straight In',
    skippedMessage: 'Here is the shape of it: each turn you place reinforcements, attack neighbouring territories with dice, then fortify. Research a tech and advance Ancient → Medieval along the way — that is the part classic conquest games don\'t have. This board is won by domination: capture every territory; a Quick Match is won sooner, by holding 65% of the map. Press the gold button below to start playing — you can replay this lesson from the Training Academy any time.',
    detail: 'Real matches can add what this board left out: factions with unique powers, stability, fog of war, a stiffer advancement gate (more research plus buildings), and the full Ancient → Modern spine instead of a two-era hop. Territory cards are already on: a turn with a capture earns one, and a set of three trades in for bonus units.',
    variant: 'wrapup',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const COMBINED_CORE_STEP_IDS = [
  'welcome',
  'draft_do',
  'choose_front',
  'fortify_do',
  'turn_ends',
  'economy_intro',
  'ea_research',
  'ea_advance',
  'wrapup',
] as const;

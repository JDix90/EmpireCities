import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Territory Threshold. One match on the real galaxy board, two
 * seats, played for the threshold: hold 60% of the map (`checkVictory` in
 * gameStateManager.ts, judged from round 2).
 *
 * What is the galaxy's own here is the denominator. The share is of EVERY
 * system in the game, the neutral colonies included, and the count needed is
 * the whole number at or above the percentage: 39 of this board's 64 at the
 * galaxy lobby's default of 60%. The player opens one short — Sol III, the
 * whole of Nexus Station and a six-system beachhead on Verdan — and takes the
 * 39th by ground from Saffron Mire. The opening is `galaxyThresholdScenario.ts`
 * (backend); the numbers on the cards are recomputed from the map and
 * `utils/mapControl.ts` by the unit test, so a change to either fails there.
 *
 * Gates: `gth_draft` on the phase change, `gth_take` on the one capture that
 * matters, `gth_win` on the game being won, which the server judges from
 * round 2.
 */
export const GALAXY_THRESHOLD_STEPS: TutorialStep[] = [
  {
    id: 'gth_welcome',
    title: 'Territory Threshold in the Galaxy',
    message: 'This match is played for **Threshold** victory: hold **60%** of the map. You are the Stellar Mandate of **Sol III**, and you have already settled the whole of **Nexus Station** and landed six systems deep on **Verdan Reach**, across the two Sol–Verdan lanes. The Helion Navigators hold the rest of Verdan. The **Rust Belt** is a neutral colony nobody has claimed.',
    detail: 'The galaxy counts **every** system on the board, the neutral colonies included: 60% of 64 is 38.4, so the win needs **39**. Domination would need all 64 — every colony garrison as well as every rival — which is why a galaxy lobby opens with Threshold on at 60% beside it, and a 90-turn limit behind both.',
    hint: 'Click Next, or Skip to the end to jump straight in.',
    skippable: true,
  },
  {
    id: 'gth_meter',
    title: 'Read the Map Control Meter',
    message: 'The top bar shows **59%/60%**, and the **Objectives** panel in the sidebar\'s Status tab spells it out: **Map control: 59% of 60% · 38 of 39 territories**, with **Hold 60% of the map — 39 of its 64 territories — to win. 1 more to go.** under it. The share is rounded down, so the meter never claims a win the server has not given.',
    detail: 'The count needed is the whole number at or above 60% of the board; the meter and the server use the same expression, so they never disagree about the last system. In a 2v2 or with Allied houses your side\'s systems count together, and the lobby moves the default to **75%** when 2v2 is switched on. Judged from round 2, like every win but Domination.',
    whyItMatters: 'Nobody reinforces a colony. The sixteen neutral Rust systems sit in the 64 whoever holds them, so in a real match the colonies are the cheapest way to the number.',
  },
  {
    id: 'gth_draft',
    title: 'Stack Saffron Mire',
    message: `Click **Saffron Mire** — your beachhead system beside Spore Reach, highlighted — dial **All** and press **Place**. Then click the gold **${phaseAdvanceLabel('draft')}** button.`,
    detail: 'A 38-system empire drafts big: a third of its systems, plus a bonus for every region it holds whole — each scaled by the number of seats, a third of its listed value at two, and never below one. One thing to know about Verdan in a real match: its storms thin any stack above 12 by one unit each round.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_saffron_mire',
    requireAction: 'end_phase',
  },
  {
    id: 'gth_take',
    title: 'Take the 39th System',
    message: 'Click **Saffron Mire**, then **Spore Reach** beside it. This is a ground attack on the same world, so it rolls the full 3 dice — no lane cap. **Attack until captured** presses until it falls, and up to 3 of your attackers move in on their own.',
    detail: 'Any system would do: the 39th could as well have been a neutral Rust Belt garrison across a lane. The Navigators hold Spore Reach with two units and no defence bonus.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_spore_reach',
    requireAction: 'territory_captured',
  },
  {
    id: 'gth_win',
    title: 'Judged From Round 2',
    message: `The meter reads **60% of 60% · 39 of 39 territories** in gold. If this is still round 1, finish your turn with **${phaseAdvanceLabel('attack')}** and **${phaseAdvanceLabel('fortify')}**: the win lands as round 2 opens, before you place a unit. Taken in round 2 or later, the game ended on the capture.`,
    detail: 'Every seat gets a first turn before any threshold is read: a seat dealt a whole world could otherwise cross the line before the last seat had placed a unit. In a real match the 90-turn limit is the other end of the same count — past it, with nobody over the line, the most systems win.',
    requireAction: 'game_won',
  },
  {
    id: 'gth_complete',
    title: 'Territory Threshold Complete',
    message: 'You took the 39th system and crossed 60% of the galaxy. In a real match the count is the same whoever holds the rest: colonies, rivals and empty garrisons all sit in the 64, and the meter in the top bar tells you how many more you need.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: you hold **38 of the 39** systems that 60% of this board needs. Take one more — **Spore Reach**, beside your **Saffron Mire** — and the win is judged from round 2. Right now you have reinforcements to place — click **Saffron Mire**, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_THRESHOLD_STEP_IDS = [
  'gth_welcome',
  'gth_meter',
  'gth_draft',
  'gth_take',
  'gth_win',
  'gth_complete',
] as const;

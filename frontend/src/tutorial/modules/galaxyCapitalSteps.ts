import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Capital Capture. One match on the real galaxy board, two
 * seats, played for capitals: hold your own and take every living rival's
 * (`playerSatisfiesCapitalVictory` in gameStateManager.ts, judged from round 2).
 *
 * What is the galaxy's own here is where the capitals fall. The deal fixes
 * each seat's capital at the start, and on this board the Mandate's is Amazon
 * Basin and the Navigators' is Chlorophage Span — both gateways, so the
 * winning attack is a lane crossing at the 2-die cap. The opening is
 * `galaxyCapitalScenario.ts` (backend); the capitals are the deal's, pinned
 * by that scenario's test, and the systems named here are pinned to the map.
 *
 * Gates: `gcp_draft` on the phase change, `gcp_cross` on the one capture that
 * matters, `gcp_win` on the game being won, which the server judges from
 * round 2.
 */
export const GALAXY_CAPITAL_STEPS: TutorialStep[] = [
  {
    id: 'gcp_welcome',
    title: 'Capital Capture in the Galaxy',
    message: 'This match is played for **Capital** victory: hold your own capital and take every rival\'s. You are the Stellar Mandate of **Sol III**, and your capital is **Amazon Basin**. The Helion Navigators hold **Verdan Reach**, and theirs is **Chlorophage Span**.',
    detail: 'The deal fixes each seat\'s capital as the game opens, and on this board both fell on **gateways**: Amazon Basin is Sol\'s door to Nexus Station, Chlorophage Span is Verdan\'s door facing your Guinea Coast. So the winning attack here is a lane crossing, at the 2-die lane cap.',
    hint: 'Click Next, or Skip to the end to jump straight in.',
    skippable: true,
    linkModule: 'galaxy_primer',
  },
  {
    id: 'gcp_rules',
    title: 'Read the Capitals',
    message: 'Every capital is marked on the map, and the **Objectives** panel in the sidebar reads **Your capital: Amazon Basin** with the rule under it: hold it and take every rival capital, judged from round 2. Lose Amazon Basin and the panel turns red — you cannot win by capitals until you retake it.',
    detail: 'Only living rivals count: an eliminated seat\'s capital no longer needs holding. In a 2v2 or with Allied houses the side wins when every living capital is in its members\' hands between them.',
    whyItMatters: 'A capital on a gateway is both the prize and the door. Whoever holds Chlorophage Span holds the Sol–Verdan lane\'s far end, and a Sovereignty corridor with it.',
  },
  {
    id: 'gcp_draft',
    title: 'Stack Guinea Coast',
    message: `Click **Guinea Coast** — your gateway facing Chlorophage Span, highlighted — dial **All** and press **Place**. Then click the gold **${phaseAdvanceLabel('draft')}** button.`,
    detail: 'Its Gateway card lists the lane to Verdan Reach as **Open**: you hold this end, the Navigators hold their capital at the other. Amazon Basin needs nothing: the tutorial opponent never attacks, but in a real match your capital is the system to garrison.',
    cardPosition: 'aside',
    targetTerritoryId: 'sol_guinea',
    requireAction: 'end_phase',
  },
  {
    id: 'gcp_cross',
    title: 'Take the Rival Capital',
    message: 'Click **Guinea Coast**, then **Chlorophage Span** across the lane. A lane attack rolls at most 2 dice; **Attack until captured** presses until the capital falls, and up to 3 of your attackers move in on their own.',
    detail: 'The Navigators defend a lane with no extra die. Eight against two wins through the cap over a few rolls.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_chlorophage_span',
    requireAction: 'territory_captured',
  },
  {
    id: 'gcp_win',
    title: 'Judged From Round 2',
    message: `Both capitals are yours. If this is still round 1, finish your turn with **${phaseAdvanceLabel('attack')}** and **${phaseAdvanceLabel('fortify')}**: the win lands as round 2 opens, before you place a unit. Taken in round 2 or later, the game ended on the capture.`,
    detail: 'The round-2 rule exists for capitals above all: with three starting units, a capital could otherwise fall to the first seat\'s dice before the last seat had placed one.',
    requireAction: 'game_won',
  },
  {
    id: 'gcp_complete',
    title: 'Capital Capture Complete',
    message: 'You held Amazon Basin and took Chlorophage Span across its lane. In a real galaxy match the capitals on gateways are the systems everyone fights for twice over — as capitals, and as the ends of lanes.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: hold your capital, **Amazon Basin**, and take the Navigators' capital, **Chlorophage Span**, from **Guinea Coast** across the lane; the win is judged from round 2. Right now you have reinforcements to place — click **Guinea Coast**, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_CAPITAL_STEP_IDS = [
  'gcp_welcome',
  'gcp_rules',
  'gcp_draft',
  'gcp_cross',
  'gcp_win',
  'gcp_complete',
] as const;

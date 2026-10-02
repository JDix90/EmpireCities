import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Secret Missions and Alliances. One match on the real galaxy
 * board, two seats, played for secret missions: the player is dealt "Own
 * Guinea Coast and Pacific Rim", the two Sol gateways across the Sol–Verdan
 * lanes, and takes both.
 *
 * What is the galaxy's own here (backend/src/game-engine/victory/missions.ts):
 * the dealer never names ground behind a hyperspace gate, and on this map every
 * world but Sol III is orbit-gated, so a capture or control mission names Sol
 * ground and nothing else — and a seat already holding all of Sol can only draw
 * an eliminate mission. Alliances (two humans, four or more seats, about one
 * deal in five) cannot be dealt to one human, so the lesson explains them on a
 * card and performs the capture mission.
 *
 * The opening is `galaxySecretMissionsScenario.ts` (backend); the systems named
 * here are pinned to it and to the galaxy map by the tests.
 *
 * Gates: the first capture advances `gsm_first` (either system — the order is
 * the player's); `gsm_second` waits on the mission reading complete on the
 * board, so it never asks for a system already taken; `gsm_win` waits on the
 * game being won, which the server judges from round 2.
 */
export const GALAXY_SECRET_MISSIONS_STEPS: TutorialStep[] = [
  {
    id: 'gsm_welcome',
    title: 'Secret Missions in the Galaxy',
    message: 'This match is played for **Secret Missions**: every seat is dealt a private objective as the game opens, and completing yours wins. You play the Helion Navigators of **Verdan Reach**; the Stellar Mandate holds **Sol III** across two hyperspace lanes. Yours reads **Own Guinea Coast and Pacific Rim** — the two Sol gateways facing your world.',
    detail: 'The galaxy changes the deal. A mission never names a world behind a hyperspace gate, and here every world but Sol III is one: every capture or control mission on this map names Sol ground, so it is always a lane crossing away. A seat that already holds all of Sol can only ever draw an eliminate mission. Missions are judged from round 2.',
    hint: 'Click Next, or Skip to the end to jump straight in.',
    skippable: true,
  },
  {
    id: 'gsm_objectives',
    title: 'Read Your Mission',
    message: 'The **Objectives** panel in the sidebar\'s Status tab shows it: **Mission: Own Guinea Coast and Pacific Rim**. Nobody else can see it — a mission is revealed only to its holder, to eliminated players and on the result screen. The Mandate\'s mission is just as private.',
    detail: 'Three mission kinds exist on this board: own two named systems, control one or two named regions, or eliminate a named player yourself (if anyone else does it, the mission fails). Era Advancement adds "reach an era"; the Space Age adds Moon objectives.',
    whyItMatters: 'A rival who guesses your mission can hold the one gateway you need. Two seats can even draw the same objective: missions are dealt separately.',
  },
  {
    id: 'gsm_alliance',
    title: 'Alliances, and Why Not Here',
    message: 'In a game of **four or more seats with at least two humans**, about one deal in five hands two of them an **alliance** instead of missions: each must hold an even share of the dealt systems plus 7% — 21 each on the four-seat galaxy board — with both still standing, and they win together as an Alliance Victory.',
    detail: 'Team games drop missions altogether: in a 2v2 or with Allied houses a mission could name an ally to eliminate, so the lobby greys the condition out. One human against the AI can never be dealt an alliance, which is why this lesson performs a capture mission.',
  },
  {
    id: 'gsm_draft',
    title: 'Stack a Gateway',
    message: `Click **Chlorophage Span** — your gateway facing Guinea Coast, highlighted — dial **All** and press **Place**. Then click the gold **${phaseAdvanceLabel('draft')}** button.`,
    detail: 'Its Gateway card lists the lane to Sol III as **Open**: you hold this end, the Mandate holds Guinea Coast at the other. Greenfire Vault, your other gateway, faces Pacific Rim the same way.',
    hint: 'Navigators draft +2 a turn. Keep Verdan Reach\'s stacks under 12: its storms shed a unit a round from anything taller.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_chlorophage_span',
    requireAction: 'end_phase',
  },
  {
    id: 'gsm_first',
    title: 'Take the First Gateway',
    message: 'Click **Chlorophage Span**, then **Guinea Coast** across the lane, and attack until it falls — a lane attack rolls at most 2 dice, so **Attack until captured** saves the clicking. Either gateway first; the mission reads both.',
    detail: 'Up to 3 attackers move in on their own. Leave the rest: Guinea Coast borders five Sol systems, but holding the gateway is all the mission wants.',
    cardPosition: 'aside',
    targetTerritoryId: 'sol_guinea',
    requireAction: 'territory_captured',
  },
  {
    id: 'gsm_second',
    title: 'Take the Second',
    message: 'Now the other lane: **Greenfire Vault → Pacific Rim**. When both named systems are yours the Objectives panel\'s mission line is done, and so is the game — from round 2.',
    cardPosition: 'aside',
    targetTerritoryId: 'sol_pacific_rim',
    requireAction: 'mission_complete',
  },
  {
    id: 'gsm_win',
    title: 'Judged From Round 2',
    message: `Both gateways are yours. If this is still round 1, finish your turn with **${phaseAdvanceLabel('attack')}** and **${phaseAdvanceLabel('fortify')}**: the win lands as round 2 opens, before you place a unit. Completed in round 2 or later, the game ended on the capture.`,
    detail: 'Hold them through the Mandate\'s turn. A mission is judged on what you hold at the check, not on what you once took.',
    requireAction: 'game_won',
  },
  {
    id: 'gsm_complete',
    title: 'Secret Missions Complete',
    message: 'You read a mission, took both systems it named across their lanes, and won on it. In a real galaxy match a Sol holder can only draw an eliminate mission, and everyone else\'s capture missions point at Sol — so expect company on its gateways.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: your mission is in the Objectives panel — **Own Guinea Coast and Pacific Rim**, the two Sol gateways across your lanes. Take **Guinea Coast** from **Chlorophage Span** and **Pacific Rim** from **Greenfire Vault**; the win is judged from round 2. Right now you have reinforcements to place — click **Chlorophage Span**, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_SECRET_MISSIONS_STEP_IDS = [
  'gsm_welcome',
  'gsm_objectives',
  'gsm_alliance',
  'gsm_draft',
  'gsm_first',
  'gsm_second',
  'gsm_win',
  'gsm_complete',
] as const;

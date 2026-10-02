import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Domination. One match on the real galaxy board, two seats,
 * played for Domination alone — and what the galaxy makes of it.
 *
 * What is the galaxy's own here: `checkVictory` (gameStateManager.ts) reads
 * last standing before anything else, and a seat whose last system falls is
 * eliminated on the spot, so with a rival in the game a result never reads
 * Total Domination: the last rival's fall ends it as Last Commander Standing,
 * the one win judged at once rather than from round 2, and the neutral colony
 * garrisons never need taking. The player does exactly that: the Navigators
 * are down to Greenfire Vault, and the player takes it by ground from Glowmire
 * Shelf in round 1. The opening is `galaxyDominationScenario.ts` (backend);
 * the systems and counts named here are pinned to the map by the unit test.
 *
 * Gates: `gdm_draft` on the phase change, `gdm_take` on the capture (the
 * combat result lands before the game-over event it causes), `gdm_win` on
 * the game being won.
 */
export const GALAXY_DOMINATION_STEPS: TutorialStep[] = [
  {
    id: 'gdm_welcome',
    title: 'Domination in the Galaxy',
    message: 'This match is played for **Domination** alone: the briefing reads **Control every territory**, and on this board that is all **64** systems. You are the Stellar Mandate of **Sol III**. The Helion Navigators are down to one system on **Verdan Reach** — **Greenfire Vault**, the gateway facing your Pacific Rim — and you hold the other fifteen around it. **Nexus Station** and the **Rust Belt** are neutral colonies.',
    detail: 'Here is what the galaxy does to Domination: the game never gets there. The moment the last rival falls the server ends the match as **Last Commander Standing**, the one win judged at once rather than from round 2 — so the **32** colony garrisons never need taking, and a galaxy result never reads Total Domination while a rival is in the game. That is why a real galaxy lobby pairs Domination with the Threshold.',
    hint: 'Click Next, or Skip to the end to jump straight in.',
    skippable: true,
  },
  {
    id: 'gdm_rules',
    title: 'Last Commander Standing',
    message: 'The sidebar\'s **Status** tab lists no objective for Domination — there is nothing to count toward but the board itself. What ends the game is an elimination: when a seat loses its last system the **Player Eliminated** screen names who took it, and if nobody else is left the result screen reads **Last Commander Standing — all opponents eliminated**.',
    detail: 'Eliminations are judged in round 1 too, which is why a two-unit capital or a lone gateway is a real risk on the first turn. Neutral colonies belong to nobody, so taking or ignoring them changes nothing here; in a Threshold game they count. A resignation is an elimination as well, credited to no one.',
    whyItMatters: 'A rival with one system left is one attack from ending the game — and a rival who knows that drafts at least three units a turn onto it.',
  },
  {
    id: 'gdm_draft',
    title: 'Stack Glowmire Shelf',
    message: `Click **Glowmire Shelf** — your system beside Greenfire Vault, highlighted — dial **All** and press **Place**. Then click the gold **${phaseAdvanceLabel('draft')}** button.`,
    detail: 'In a real match a seat down to one system still drafts at least three units a turn onto it, so the longer it stands the harder it gets. The tutorial opponent never attacks, but it would reinforce — take it now.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_glowmire_shelf',
    requireAction: 'end_phase',
  },
  {
    id: 'gdm_take',
    title: 'Take Their Last System',
    message: 'Click **Glowmire Shelf**, then **Greenfire Vault** beside it. A ground attack rolls the full 3 dice; **Attack until captured** presses until it falls. The capture eliminates the Navigators, and with no rival left the game ends on the spot.',
    detail: 'No waiting for round 2: Last Commander Standing is judged the moment it happens. You will see the Player Eliminated screen, then the result.',
    cardPosition: 'aside',
    targetTerritoryId: 'verdan_greenfire_vault',
    requireAction: 'territory_captured',
  },
  {
    id: 'gdm_win',
    title: 'Judged at Once',
    message: 'The result screen reads **Victory!** with **Last Commander Standing — all opponents eliminated** under it — not Total Domination, though Domination was the only condition set. **32** neutral systems still stand on Nexus Station and the Rust Belt; none of them mattered.',
    detail: 'That is the galaxy\'s Domination in practice: eliminate every rival, and leave the colonies to whoever wants them. Against rivals who hold their home worlds that can take a long time, which is why a real galaxy lobby adds the 60% threshold and a 90-turn limit.',
    requireAction: 'game_won',
  },
  {
    id: 'gdm_complete',
    title: 'Domination Complete',
    message: 'You eliminated the last rival and the galaxy ended the match at once. Domination here is a race to the last seat, not to the last system; the colonies are the Threshold\'s business.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: the Navigators hold one system, **Greenfire Vault**, and you hold **Glowmire Shelf** beside it. Take it and the game ends at once as Last Commander Standing — no round-2 wait. Right now you have reinforcements to place — click **Glowmire Shelf**, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_DOMINATION_STEP_IDS = [
  'gdm_welcome',
  'gdm_rules',
  'gdm_draft',
  'gdm_take',
  'gdm_win',
  'gdm_complete',
] as const;

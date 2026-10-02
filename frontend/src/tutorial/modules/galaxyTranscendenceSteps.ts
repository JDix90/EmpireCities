import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Transcendence, on the Space to Stars board. Transcendence is
 * the win for reaching a spine's last era with a wonder in hand
 * (`checkVictory` in gameStateManager.ts), and `space_to_stars` is the one
 * spine whose last era is the Galactic Age, so this is the one lesson that
 * does not start on the galaxy map: it starts in the Space Age on Earth and
 * the Moon, and the far worlds arrive when the player advances.
 *
 * The opening is `galaxyTranscendenceScenario.ts` (backend): the Lunar
 * Pioneers hold Oceania and Southern African Union, where their Launch Pad
 * stands. The Pioneers matter because leaving the Space Age needs a Space
 * Program, and they have Moon access from turn one — so the gate the player
 * clears is research and buildings only.
 *
 * Gates:
 *   - `gtr_research` waits on the first research; `gtr_build` on the first
 *     non-wonder building; `gtr_gate` on the advance itself, which is the one
 *     beat the lesson exists for.
 *   - `gtr_arrive` waits on the Galaxy chart, which only exists once the far
 *     worlds are on the board.
 *   - `gtr_wonder` waits on the wonder, `gtr_win` on the game being won: the
 *     build itself triggers the win check from round 2, and before that the
 *     win lands as round 2 opens.
 */
export const GALAXY_TRANSCENDENCE_STEPS: TutorialStep[] = [
  {
    id: 'gtr_welcome',
    title: 'Transcendence',
    message: 'This match plays the **Space to Stars** climb: it opens in the **Space Age** on Earth and the Moon, and the Galactic Age\'s three far worlds are not on the board until someone reaches it. You play the **Lunar Pioneers**. **Transcendence** is the win for the player who reaches the spine\'s last era — here the Galactic Age — and holds a wonder.',
    detail: 'Leaving the Space Age takes the milestone gate (2 tier-1, 2 tier-2 and 1 tier-3 technologies, and 3 buildings) and a working **Space Program**. The Pioneers have Moon access from turn one, so for you the gate is research and buildings. Like every win but Domination, Transcendence is judged from round 2.',
    hint: 'You have been granted the research and the production points the climb needs, with little to spare. Click Next, or Skip to the end to jump straight in.',
    skippable: true,
  },
  {
    id: 'gtr_research',
    title: 'Research Toward the Gate',
    message: 'Open the Tech Tree. The **Advancement gate → Galactic Age** rail at the top lists the chips to clear. Research **Megacity Logistics** first: it unlocks the Workshop, and the gate wants three buildings — your Launch Pad on **Southern African Union** is already one.',
    detail: 'The cheapest path through the gate: Megacity Logistics and Digital Warfare (the two tier-1 roots), Fusion Power Grid and AI-Directed Command on top of them, then Hypersonic Swarm or Quantum Computing Grid for the tier-3.',
    hint: 'Research is allowed in any phase of your turn. Tap Open Tech Tree below.',
    actionOpenTechTree: true,
    requireAction: 'tech_researched',
  },
  {
    id: 'gtr_build',
    title: 'Raise a Workshop',
    message: 'Click **Australian Meridian** — highlighted — and in its **Build** section raise a **Workshop** (3 PP). Building is allowed in the Reinforcement and Fortify phases.',
    detail: 'Then raise a second one on another of your systems: with the Launch Pad that makes the gate\'s three buildings. A Workshop pays +1 PP a turn, and the count is what the gate reads.',
    cardPosition: 'aside',
    targetTerritoryId: 'oc_australia',
    requireAction: 'building_built',
  },
  {
    id: 'gtr_gate',
    title: 'Clear the Gate and Advance',
    message: 'Finish the research and the second Workshop until every chip in the rail is green, then press **Advance to Galactic Age** right there in the rail (the **Era Advancement** panel in the sidebar has the same button). The advance costs PP as well.',
    detail: 'Advancing consolidates your armies: about 30% of your units are lost for good, and for one turn your defenders fight weaker. Your Space Age research is wiped — the arriving era gates its lanes by position, not by tech — and you gain the **Pathfinder Gate**: the lanes to worlds you have not reached are yours alone for two rounds.',
    hint: 'Advance in your Reinforcement or Fortify phase. Short on a chip? The rail names what is missing.',
    requireAction: 'era_advanced',
  },
  {
    id: 'gtr_arrive',
    title: 'The Far Worlds Open',
    message: 'You are in the Galactic Age. Three new world tabs — **Verdan Reach**, **Rust Belt**, **Nexus Station** — opened for everyone as neutral frontiers, gateways softest, and your faction followed its lineage into the **Helion Navigators**. Click **Galaxy chart** above the board to see the ring.',
    detail: 'Your rival is still in the Space Age, on the Moon ladder. The Galactic Age gates its lanes by holding a gateway, so the tech wipe cost you nothing you still need.',
    requireAction: 'galaxy_chart_opened',
  },
  {
    id: 'gtr_wonder',
    title: 'Raise the Hyperlane Anchor',
    message: 'Your era\'s wonder is now the **Hyperlane Anchor** (22 PP). Click any of your systems and raise it from the wonder row at the bottom of the **Build** section.',
    detail: 'Transcendence needs the final era and a wonder in hand; the Anchor also lets your attacks across hyperspace lanes roll full dice. One wonder per game, so whoever raises it first keeps it.',
    requireAction: 'wonder_built',
  },
  {
    id: 'gtr_win',
    title: 'Judged From Round 2',
    message: `If this is still round 1, end your turn with **${phaseAdvanceLabel('fortify')}**: the win lands as round 2 opens, before you place a unit. Raised in round 2 or later, the game ended the moment the Anchor rose.`,
    detail: 'The round-2 rule guards every alternative win: a capital with its three starting units could otherwise fall to the first seat\'s dice before the last seat had placed one.',
    requireAction: 'game_won',
  },
  {
    id: 'gtr_complete',
    title: 'Transcendence Complete',
    message: 'You cleared the Space Age gate, arrived in the Galactic Age with the Pathfinder Gate in hand and raised the Hyperlane Anchor. In a real Space to Stars match every other seat needs the full Space Program to follow you, and the far worlds are yours to land on first.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: research past the gate (2 tier-1, 2 tier-2, 1 tier-3 technologies, 3 buildings), press **Advance to Galactic Age** in the Tech Tree's gate rail, then raise the **Hyperlane Anchor** on any system you hold. The win is judged from round 2. Right now you have reinforcements to place — click any of your systems, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_TRANSCENDENCE_STEP_IDS = [
  'gtr_welcome',
  'gtr_research',
  'gtr_build',
  'gtr_gate',
  'gtr_arrive',
  'gtr_wonder',
  'gtr_win',
  'gtr_complete',
] as const;

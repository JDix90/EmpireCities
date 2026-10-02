import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/**
 * Galactic Age · Lane Sovereignty. One match on the real galaxy board, three
 * seats, in which the player completes a fifth corridor across a lane and
 * holds the network for three turn starts — the win the galaxy has and no
 * other era does (backend/src/game-engine/victory/laneSovereignty.ts).
 *
 * The opening is `galaxyLaneSovereigntyScenario.ts` (backend): the Navigators
 * hold Verdan Reach and the far gateway of every lane out of it, four corridors,
 * and the lane from Hematite Span to Antenna Spire is the fifth. Every system
 * named here is pinned to that scenario and to the galaxy map by
 * `galaxyLaneSovereigntyModule.test.ts` and the backend scenario test.
 *
 * Gates, and why they are the ones they are:
 *   - `gls_chart` waits on the Galaxy chart being opened, so the first thing
 *     the player reads the lanes on is the chart that colours them.
 *   - `gls_draft` waits on `end_phase`, as the core lesson's draft card does:
 *     one card covering "place, then press the gold button" leaves no seam for
 *     the draft→attack transition to eat the attack card.
 *   - `gls_cross` waits on the one capture that matters (`targetTerritoryId`),
 *     not on any capture — a stray attack elsewhere must not read as done.
 *   - The two holding cards wait on `my_next_turn`, an EDGE: the player's own
 *     phase changes leave them in place, and each advances only when the turn
 *     has come back round, which is exactly when the streak ticks.
 *   - `gls_win` waits on the game being won. The win lands at the player's
 *     turn start, from the server, before they act.
 */
export const GALAXY_LANE_SOVEREIGNTY_STEPS: TutorialStep[] = [
  {
    id: 'gls_welcome',
    title: 'Lane Sovereignty',
    message: 'The Galactic Age is four worlds in a ring — **Sol III – Verdan Reach – Rust Belt – Nexus Station** — joined by eight hyperspace lanes, each landing on a **gateway** system at either end. You play the Helion Navigators of Verdan Reach, and this match adds the galaxy\'s own way to win: **Lane Sovereignty**.',
    detail: 'A lane is your **corridor** when you hold both of its gateways. Hold 5 of the 8 lanes at the start of your turn, 3 turns running, and the network is yours. A duel or a 2v2 needs 5 turns instead, and only the eight charted lanes count.',
    hint: 'You already hold four corridors. This lesson takes the fifth and holds it. Click Next, or Skip to the end to jump straight in.',
    skippable: true,
    linkModule: 'galaxy_primer',
  },
  {
    id: 'gls_chart',
    title: 'Read the Galaxy Chart',
    message: 'The board opens on the **Galaxy chart**. Click the **Galaxy chart** button above the board — it is how you come back from any world tab — and read the lanes: a lane in **your colour** is a corridor, a **blue** lane is open (you hold one end), a dim lane is closed to you. The Objectives panel in the sidebar keeps score: **corridors 4 of 5 · held 0 of 3 rounds**.',
    detail: 'With three seats the ring\'s two gaps are bridged by colony lanes. They carry attacks like any lane, but Lane Sovereignty counts only the eight charted ones.',
    hint: 'On a phone the Galaxy chart chip sits in the Worlds row above the board. A world tab opens that world on its own.',
    requireAction: 'galaxy_chart_opened',
  },
  {
    id: 'gls_charts',
    title: 'Research Lane Charts',
    message: 'An attack across a lane rolls at most **2 dice**, not 3 — a defended gateway holds like a coast. **Lane Charts** buys the third die back. Open the Tech Tree and research it; you have been granted exactly its cost.',
    detail: 'Lane Charts is the galaxy\'s tier-1 lane root. The Hyperlane Anchor wonder lifts the cap entirely, and the Void Custodians roll an extra die when they defend a lane.',
    hint: 'Research is allowed in any phase of your turn. Tap Open Tech Tree below.',
    actionOpenTechTree: true,
    requireAction: 'tech_researched',
  },
  {
    id: 'gls_draft',
    title: 'Stack Your Gateway',
    message: `Click **Hematite Span** — your gateway on the Rust Belt, highlighted — dial **All** and press **Place**. Then click the gold **${phaseAdvanceLabel('draft')}** button.`,
    detail: 'Open the **Rust Belt** tab to find it. Its Gateway card lists the lane to Nexus Station as **Open**: you hold this end, and the Void Custodians hold **Antenna Spire** at the far end.',
    hint: 'Navigators draft +2 a turn. Keep Verdan Reach\'s stacks under 12: its storms shed a unit a round from anything taller.',
    cardPosition: 'aside',
    targetTerritoryId: 'rust_hematite_span',
    requireAction: 'end_phase',
  },
  {
    id: 'gls_cross',
    title: 'Cross the Lane',
    message: 'Click **Hematite Span**, then **Antenna Spire** across the lane. The attack row shows the dice a crossing rolls. Attack again, or **Attack until captured**, until the gateway falls.',
    detail: 'Taking it makes the Rust–Nexus lane your fifth corridor. The combat card shows the Custodians\' extra defence die on a lane crossing — twelve against two wins through it over a few rolls.',
    hint: 'Only an attack from a gateway can cross a lane: the lane is the border.',
    cardPosition: 'aside',
    targetTerritoryId: 'nexus_antenna_spire',
    requireAction: 'territory_captured',
  },
  {
    id: 'gls_hold_1',
    title: 'Five Corridors — Now Hold Them',
    message: `The Objectives panel reads **corridors 5 of 5**. The streak advances only at the start of **your** turn, so click **${phaseAdvanceLabel('attack')}** and then **${phaseAdvanceLabel('fortify')}**, and watch the two rival turns pass.`,
    detail: 'A rival breaks a corridor by taking either of its gateways on their turn, before your streak ticks. The tutorial opponents never attack; real ones will.',
    requireAction: 'my_next_turn',
  },
  {
    id: 'gls_hold_2',
    title: 'Held 1 of 3 Rounds',
    message: `Your turn again, and the streak ticked: **held 1 of 3 rounds**. Place your reinforcements where they shore up a gateway, then run the turn through to **${phaseAdvanceLabel('fortify')}**.`,
    detail: 'A Void Custodian could buy a round with an **Emergency Seal**: it closes one lane touching Nexus Station to everyone else until their next turn. It stops the attacks across a lane, not the corridor itself.',
    requireAction: 'my_next_turn',
  },
  {
    id: 'gls_win',
    title: 'Held 2 of 3 — One More Turn Start',
    message: `End this turn as well. When your turn comes round again the streak reaches 3, and the game ends on **Lane Sovereignty** before you place a unit.`,
    detail: 'Every galaxy win but Domination is judged from round 2, once every seat has had a turn; Sovereignty\'s three rounds take care of that on their own.',
    requireAction: 'game_won',
  },
  {
    id: 'gls_complete',
    title: 'Lane Sovereignty Complete',
    message: 'You crossed a lane, completed a fifth corridor and held the network for three turn starts. In a real match the rivals fight you for every gateway, and a corridor that falls on their turn resets your streak to zero.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: `Here is the shape of it: hold both gateways of 5 of the 8 charted lanes at the start of your turn, 3 turns running (5 in a duel or a 2v2). You hold four corridors now. Take **Antenna Spire** from **Hematite Span** across the lane for the fifth, then hold it. Right now you have reinforcements to place — click **Hematite Span**, then ${phaseAdvanceLabel('draft')}.`,
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_LANE_SOVEREIGNTY_STEP_IDS = [
  'gls_welcome',
  'gls_chart',
  'gls_charts',
  'gls_draft',
  'gls_cross',
  'gls_hold_1',
  'gls_hold_2',
  'gls_win',
  'gls_complete',
] as const;

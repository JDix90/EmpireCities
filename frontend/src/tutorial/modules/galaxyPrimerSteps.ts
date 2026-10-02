import type { TutorialStep } from '../types';

/**
 * Galactic Age · the primer. Six cards of reading and one click on a real
 * four-seat board (every faction on its home world, nothing authored), on
 * what the galaxy changes: the ring of worlds and lanes, the chart, each
 * world's rule and each faction's kit, the boards by seat count and the team
 * boards, lane weather, seals and Jump Gates, and the seven wins with the
 * galaxy's twist on each. The six Galactic Age lessons link their welcome
 * cards here (`linkModule`); this card list links nowhere, since it is the
 * start of the track.
 *
 * Every number and rule here is the engine's, and the unit tests recompute
 * them: the frontend test from the map and the client's rule mirrors
 * (`utils/galaxyLanes.ts`), the backend test from the engine's constants.
 * The world-rule sentences are `describeWorldRules`' own, so the card reads
 * exactly as the Bonuses panel does.
 *
 * Gates: `gpr_chart` waits on the Galaxy chart being opened (the desktop
 * button or the phone chip); every other card is reading.
 */
export const GALAXY_PRIMER_STEPS: TutorialStep[] = [
  {
    id: 'gpr_welcome',
    title: 'The Galactic Age, in Brief',
    message: '**Four worlds, one war.** The Galactic Age is played across **Sol III**, **Verdan Reach**, the **Rust Belt** and **Nexus Station**, joined in a ring by **8 hyperspace lanes**. Every lane runs between two **gateway** systems: hold a gateway and you can attack straight across its lane, no research needed. A crossing rolls only **2 dice** (3 with **Lane Charts**), so a defended gateway holds like a coast; the **Hyperlane Anchor** wonder lifts the cap for its owner.',
    detail: 'This primer is six cards of reading on a real four-seat board — you are the Stellar Mandate of Sol III, with a tutorial opponent on each other world — and one thing to click. Each card ends where one of the six Galactic Age lessons begins.',
    hint: 'Click Next, or Skip to the end to jump straight in.',
    skippable: true,
  },
  {
    id: 'gpr_chart',
    title: 'Read the Board',
    message: 'Click the **Galaxy chart** button above the board (on a phone, the **Galaxy chart** chip in the Worlds row). Its **Lanes** legend reads **Corridor · both gateways yours**, **Open · you hold one end**, **Closed · take a gateway first** and **Sealed · Emergency Seal, 1 round**. A world tab opens that world on its own; **Split** shows every world\'s map at once.',
    detail: 'On a world, click a gateway system: its **Gateway** card lists each lane with the far world, its state, and the dice a crossing rolls — **Lane attacks roll 2 dice (3 with Lane Charts)**.',
    hint: 'Double-click a world on the chart, or its **Enter world →** button, to drill in.',
    requireAction: 'galaxy_chart_opened',
  },
  {
    id: 'gpr_worlds',
    title: 'World Rules and Kits',
    message: 'Each world plays by one rule of its own, listed in the start briefing and the **Bonuses** panel. **Sol III** — Cradle: every 5th round, any system held here with fewer than 2 units musters 1 more. **Verdan Reach** — Storms: at round start any system above 12 units loses 1 to the weather. **Rust Belt** — Forge: a system with a defence building rolls +1 extra defence die. **Nexus Station** — The Vault: Nexus Gate Ring starts neutral (garrison 6); hold all of it for +2 tech per turn and one Emergency Seal per turn on any lane. Its home faction starts with +1 unit per system, paying for the ring it begins without.',
    detail: 'The kits. **Stellar Mandate**: the Cradle above, and **Blockade Runner** — once per turn, your next attack across a hyperspace lane ignores an Emergency Seal. **Forge Syndicate**: +2 reinforcements a turn, Jump Gates at half price, and **Supply Insert** — once per turn, place 1 free unit on an owned territory. **Helion Navigators**: +2 reinforcements a turn (+1 in a two-seat duel), every gateway in the galaxy visible, and **Drift Jump** — once per turn, fortify between two gateways you hold on different worlds with no connecting route. **Void Custodians**: +1 defence die against any attack across a lane, faster stability recovery, and the **Emergency Seal** — once per turn, close any hyperspace lane touching Nexus Station to everyone else for one round.',
  },
  {
    id: 'gpr_boards',
    title: 'Boards and Sides',
    message: 'The lobby\'s **Home Worlds** deals every faction its own world, and the board follows the seat count. **Colonies**, at two or three seats: the worlds nobody calls home start neutral and garrisoned — 5 units on each gateway and 7 inland — and at three seats two extra lanes bridge the ring\'s gaps. The classic start at four. The **Schism**, at five to eight: two houses to a shared world, each on half of it with the faction\'s kit, under the **Concord** (a truce for the first 3 rounds), in **Civil War**, or **Allied** as one side. A house holding all four of its world\'s gateways wears the **Lane Crown**: +2 units a turn.',
    detail: '**2v2** pairs the four home worlds across the ring — Sol III and the Rust Belt against Verdan Reach and Nexus Station — so every lane is a front. Allies never attack each other, see what each other sees and win together: threshold and domination count the side\'s systems together, and the lobby moves the threshold default to 75%. A team game plays without secret missions.',
  },
  {
    id: 'gpr_lanes',
    title: 'Lane Weather, Seals and Gates',
    message: 'The map itself can change. Two event cards edit it for **two rounds**: **Nebula Closure** shuts the most-contested lane to everyone, and **Lane Surge** opens a temporary lane between two worlds the ring does not join. An **Emergency Seal** — the Void Custodians\', or the Vault holder\'s — closes a lane touching Nexus Station to everyone else for one round; the Mandate\'s Blockade Runner ignores it.',
    detail: '**Jump Gates** are lanes you build: a gate on one world and another on a second — 12 production each, half for the Forge, one per world — open a private lane that moves your own units and never carries an attack, and dies with either gate. Lane Sovereignty counts the eight charted lanes only: never a surge, a colony lane or a Jump Gate.',
  },
  {
    id: 'gpr_wins',
    title: 'Seven Ways to Win, Six Lessons',
    message: '**Lane Sovereignty** is the galaxy\'s own: hold 5 of the 8 charted lanes as corridors at the start of your turn, 3 turns running — 5 in a duel or a 2v2. **Threshold** counts every system, colonies included: 60% of 64 is 39, and a galaxy lobby opens with it on at 60% — 75% in 2v2 — with a 90-turn limit behind it. **Capital**: each seat\'s capital is the first of its dealt systems in list order, and on this map that is a gateway on every world. **Secret Missions** never name ground behind a hyperspace gate, so every capture or control mission here names Sol III, and a seat holding all of Sol can only draw an eliminate mission. **Domination** ends when the last rival falls — Last Commander Standing, judged at once. **Transcendence** needs the Space to Stars board: climb from the Space Age into the Galactic Age and raise a wonder.',
    detail: 'Every win but Domination is judged from round 2, once every seat has had a turn. The **Objectives** panel in the sidebar\'s Status tab keeps score of the ones this board plays for: **Map control** and **Lane Sovereignty**. Each of the six Galactic Age lessons plays one of these wins to the end on an authored board.',
  },
  {
    id: 'gpr_complete',
    title: 'Primer Complete',
    message: 'That is the Galactic Age\'s shape: four worlds, eight lanes, gateways that decide who can attack whom, a rule to each world, boards by seat count, and every win but Domination judged from round 2. The six lessons each play one win to the end — start with Lane Sovereignty, the galaxy\'s own.',
    skippedTitle: 'Jumping Straight In',
    skippedMessage: 'You skipped the reading. The short of it: four worlds in a ring, eight lanes between gateway systems, crossings at 2 dice (3 with Lane Charts), a rule to each world, and every win but Domination judged from round 2. Back to lobby takes you to the six lessons, each of which plays one win to the end.',
    variant: 'module_complete',
  },
];

/** Step ids this list ships, in order — pinned by the unit test. */
export const GALAXY_PRIMER_STEP_IDS = [
  'gpr_welcome',
  'gpr_chart',
  'gpr_worlds',
  'gpr_boards',
  'gpr_lanes',
  'gpr_wins',
  'gpr_complete',
] as const;

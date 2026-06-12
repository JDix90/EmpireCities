import { APP_NAME } from '../../constants/brand';
import { phaseAdvanceLabel } from '../../constants/phaseLabels';
import type { TutorialStep } from '../types';

/** Required foundation path — same flow as legacy tutorial plus advanced primers. */
export const CORE_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, Commander!',
    message: `${APP_NAME} is a strategy game of territory control. Each turn has three phases: Draft → Attack → Fortify. Your goal is to conquer the map — or complete a secret mission.`,
    hint: 'Played Risk before? You\'ll feel right at home. Click "Next" to learn the details, or "Skip to the end" to jump straight in.',
  },
  {
    id: 'draft_explain',
    title: 'Draft Phase — Reinforcements',
    message: 'At the start of your turn you receive new units. The formula: 1 unit per 3 territories you hold (minimum 3), plus bonuses for controlling entire continents.',
    detail: 'Later you may also earn bonus units from card sets, technologies, and buildings — but those are optional features you can enable when creating a game.',
  },
  {
    id: 'draft_do',
    title: 'Place Your Units',
    message: 'Click one of your territories — shown in **{playerColor}** on the map — to place reinforcements there. You can spread them across multiple territories or stack them on one.',
    requireAction: 'draft',
  },
  {
    id: 'advance_draft',
    title: 'Move to Combat',
    message: `Units placed! Click the gold **${phaseAdvanceLabel('draft')}** button to move to the combat phase.`,
    hint: 'It is the gold button — in the sidebar on desktop, in the bottom bar on phones.',
    requireAction: 'end_phase',
  },
  {
    id: 'attack_explain',
    title: 'Attack Phase — Combat',
    message: 'Click one of your territories (must have 2+ units), then click an adjacent enemy territory to attack. Combat is resolved with dice.',
    detail: 'Attacker rolls up to 3 dice, defender up to 2. Highest dice are compared pair-by-pair — the loser of each pair loses a unit. Ties go to the defender. You capture a territory when its last defender falls.',
  },
  {
    id: 'attack_do',
    title: 'Launch an Attack!',
    message: 'Try attacking an adjacent enemy territory now. Attack as many times as you like — or skip straight to fortify.',
    hint: `When you're done attacking, click the gold **${phaseAdvanceLabel('attack')}** button to continue.`,
    requireAction: 'end_phase',
  },
  {
    id: 'fortify_explain',
    title: 'Fortify Phase — Reposition',
    message: 'Move units between your connected territories to shore up defenses or prepare for next turn. You can move once, or skip.',
    hint: `When you're done, click the gold **${phaseAdvanceLabel('fortify')}** button to finish your turn.`,
    requireAction: 'end_phase',
  },
  {
    id: 'opponent_turn',
    title: 'Opponent Turns',
    message: 'When it\'s not your turn, watch the action unfold. You\'ll see enemy dice rolls, territory changes, and combat results in real time. The active player is highlighted in the sidebar.',
    requireAction: 'my_turn',
  },
  {
    id: 'cards_explain',
    title: 'Territory Cards',
    message: 'Each turn you capture at least one territory, you draw a card (Infantry, Cavalry, or Artillery). Collect a matching set of 3 to trade for bonus units during your Draft phase.',
    detail: 'Valid sets: three of a kind, or one of each type. Wild cards match anything. Each trade-in gives more units than the last (4 → 6 → 8 → 10 → …), so timing matters.',
  },
  {
    id: 'victory_explain',
    title: 'How to Win',
    message: 'The default goal is world domination — capture every territory. But the host can choose other victory conditions when creating a game.',
    detail: 'Options include: Threshold (own a set percentage of the map), Capital Conquest (capture all capitals), and Secret Missions (each player gets a hidden objective like "eliminate Player 3" or "control two continents").',
  },
  {
    id: 'settings_overview',
    title: 'Game Modes & Options',
    message: 'When you create a game, you can customize the experience. Choose an era (Ancient through Space Age and more), add AI opponents, set turn timers, toggle fog of war, and enable advanced features.',
    detail: 'Advanced features include: Economy & Buildings, Technology Trees, Naval Warfare, Historical Events, Factions, and Population & Stability. Each can be toggled independently — start simple and add complexity as you like.',
  },
  {
    id: 'advanced_settings_primer',
    title: 'Advanced Settings (Preview)',
    message: 'Optional rules stack on the core loop. Turn timers keep live games brisk; async mode gives 24–72 hours per turn. Fog of war hides enemy troop counts until you scout.',
    whyItMatters: 'More features mean more decisions — enable one new system per game until you are comfortable.',
    detail: 'Economy adds buildings and production. Tech trees spend research points for passive bonuses and special abilities. Factions grant unique powers tied to history.',
  },
  {
    id: 'ability_primer',
    title: 'Faction Abilities (Preview)',
    message: 'When Factions are enabled, each player picks (or is assigned) a nation with passive bonuses and an active ability — often once per turn or once per game.',
    whyItMatters: 'Timing your ability can swing a border battle the same way a well-timed card trade does.',
    detail: 'Check the Bonuses panel in-game to see your faction\'s rules. Abilities appear on the territory panel when they are available.',
  },
  {
    id: 'tech_primer',
    title: 'Technology Tree (Preview)',
    message: 'With Tech Trees enabled you earn technology points each turn, then spend them to unlock nodes. Nodes can add attack/defense dice, reinforcements, buildings, or new abilities.',
    whyItMatters: 'Lower-tier techs unlock higher tiers — plan a path instead of buying randomly.',
    detail: 'Open the Tech Tree from the sidebar during your turn. Prerequisites are shown on locked nodes.',
  },
  {
    id: 'wrapup',
    title: 'You\'re Ready!',
    message: 'That covers the essentials. Keep playing this practice match, head to the lobby, or try a short deep-dive lesson on settings, factions, or tech.',
    variant: 'wrapup',
  },
];

import type { TutorialStep } from '../types';

export const FACTION_ABILITY_STEPS: TutorialStep[] = [
  {
    id: 'fa_welcome',
    title: 'Faction Powers',
    message:
      'This practice match has Factions enabled on the WW2 map. You play as China (the Chinese Nationalists) — a faction whose whole kit is one active ability, Guerrilla Warfare.',
    detail:
      'Faction abilities are unique and free to use. Unlike tech-tree upgrades (which cost Tech Points), most recharge every turn; a few can be used only once per game.',
  },
  {
    id: 'fa_identity',
    title: 'Know Your Faction',
    message:
      'Open the Bonuses panel to read China\'s faction entry and the Guerrilla Warfare description. China has no passive bonus; some other factions add one, such as extra reinforcements.',
    actionOpenBonuses: true,
    requireAction: 'bonuses_opened',
    hint: 'Press "Open Bonuses" below — Your Faction lists the Chinese Nationalists and their Guerrilla Warfare ability.',
    whyItMatters:
      'Knowing your kit changes how you play. China\'s edge is the free unit Guerrilla Warfare places every turn — put it where a border is thin.',
  },
  {
    id: 'fa_when',
    title: 'When Abilities Appear',
    message:
      'Active abilities appear as buttons on the Territory Panel during the right phase. Guerrilla Warfare is a Reinforcement-phase ability — select a territory you own while the phase reads Reinforcement and look for the green button.',
    detail:
      'The button is hidden in the wrong phase, once you have used it this turn, and for good after a once-per-game power is spent.',
    whyItMatters:
      'Matching your ability timing to your strategy is the skill. Guerrilla Warfare gives a free unit — ideal for plugging a weak border before your opponent attacks.',
  },
  {
    id: 'fa_use',
    title: 'Use Guerrilla Warfare',
    message:
      'During the Reinforcement phase, pick any territory you own. A green "🌿 Guerrilla Warfare" button will appear. Press it to place 1 free unit — no cards or reinforcements spent.',
    requireAction: 'ability_used',
    hint: 'Pick any territory you own, then look for the green "Guerrilla Warfare" button in the Territory Panel.',
    detail:
      'If you do not see the button, check that the phase reads "Reinforcement". It will not appear during Attack or Fortify.',
  },
  {
    id: 'fa_result',
    title: 'Ability Used!',
    message:
      'Your guerrilla fighters have reinforced the territory — 1 free unit added, no resources spent. Notice the unit count increased on the map.',
    detail:
      'Guerrilla Warfare recharges at the start of every turn, so you will always have this option. Once-per-game abilities (like Soviet Mass Mobilization) show "(once per game)" and cannot be recharged.',
    whyItMatters:
      'A free unit each turn may seem small, but over a long game it compounds — China\'s guerrilla advantage is attrition, not aggression.',
  },
  {
    id: 'fa_complete',
    title: 'Faction Lesson Complete',
    message:
      'You placed a free unit using your faction\'s active ability — exactly how it works in any game with Asymmetric Factions switched on. Each faction has a different timing, target, and scope. Check the Codex to compare all factions before your next game.',
    variant: 'module_complete',
  },
];

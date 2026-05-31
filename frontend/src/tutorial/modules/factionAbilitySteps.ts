import type { TutorialStep } from '../types';

export const FACTION_ABILITY_STEPS: TutorialStep[] = [
  {
    id: 'fa_welcome',
    title: 'Faction Powers',
    message:
      'This practice match has Factions enabled on the WW2 map. You play as China — a faction with a passive defense bonus and an active ability called Guerrilla Warfare.',
    detail:
      'Faction abilities are unique. Unlike tech-tree upgrades (which cost Tech Points), faction abilities recharge each turn automatically.',
  },
  {
    id: 'fa_identity',
    title: 'Know Your Faction',
    message:
      'Open the Bonuses panel in the sidebar to read China\'s passive bonuses (+1 defense on every territory you own) and the Guerrilla Warfare description.',
    actionOpenBonuses: true,
    requireAction: 'bonuses_opened',
    hint: 'Tap "Open Bonuses" below — the panel shows China\'s +1 defence passive and Guerrilla Warfare charges.',
    whyItMatters:
      'Understanding your passives changes where you defend. China\'s +1 defense makes interior territories very costly to attack.',
  },
  {
    id: 'fa_when',
    title: 'When Abilities Appear',
    message:
      'Active abilities appear as buttons on the Territory Panel during the correct game phase. Guerrilla Warfare is a Draft-phase ability — look for the green button when you own a territory and it is the Draft phase.',
    detail:
      'Buttons are grayed-out or hidden if you are in the wrong phase, have no ability charges, or have already used a once-per-game power.',
    whyItMatters:
      'Matching your ability timing to your strategy is the skill. Guerrilla Warfare gives a free unit — ideal for plugging a weak border before your opponent attacks.',
  },
  {
    id: 'fa_use',
    title: 'Use Guerrilla Warfare',
    message:
      'During the Draft phase, click any territory you own. A green "🌿 Guerrilla Warfare" button will appear. Tap it to place 1 free unit — no cards, no territories required.',
    requireAction: 'ability_used',
    hint: 'Tap any territory you own, then look for the green "Guerrilla Warfare" button in the Territory Panel.',
    detail:
      'If you do not see the button, check that the phase shown in the sidebar is "Reinforcement" (Draft). It will not appear during Attack or Fortify.',
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
      'You placed a free unit using your faction\'s active ability — exactly how it works in ranked matches. Each faction has a different timing, target, and scope. Check the Codex to compare all factions before your next game.',
    variant: 'module_complete',
  },
];

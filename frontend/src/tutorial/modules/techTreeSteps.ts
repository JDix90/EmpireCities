import type { TutorialStep } from '../types';

export const TECH_TREE_STEPS: TutorialStep[] = [
  {
    id: 'tt_welcome',
    title: 'Technology Tree',
    message: 'This practice match has Tech Trees enabled. You spend technology points (TP) to unlock nodes with passive bonuses, buildings or new abilities; in a full game you earn more every turn.',
    detail: 'You start with bonus TP in this lesson so you can research immediately.',
  },
  {
    id: 'tt_points',
    title: 'Technology Points',
    message: 'Your TP balance shows at the top of the Tech Tree and in the sidebar\'s Resources row. In a full game, income comes from the territories you hold (1 TP per 5), Laboratories and some technologies; this practice match pays none, so your 8 bonus TP are the budget.',
    messagePhone: 'Your TP balance shows at the top of the Tech Tree and in Resources under **☰ Menu**. In a full game, income comes from the territories you hold (1 TP per 5), Laboratories and some technologies; this practice match pays none, so your 8 bonus TP are the budget.',
    whyItMatters: 'In a full game, saving for a tier-2 node often beats buying every cheap tier-1.',
  },
  {
    id: 'tt_open',
    title: 'Open the Tech Tree',
    message: 'Open the tree to browse tiers, costs, and prerequisites. Locked nodes show what you must research first.',
    actionOpenTechTree: true,
    requireAction: 'tech_tree_opened',
    hint: 'Press "Open Tech Tree" below. Your 8 bonus TP are already available.',
  },
  {
    id: 'tt_research',
    title: 'Research a Technology',
    message: 'Select an affordable tier-1 node and press its Research button. Dice bonuses apply at once and extra reinforcements from your next turn; abilities appear on the Territory Panel.',
    requireAction: 'tech_researched',
    hint: 'Research during your Reinforcement or Fortify phase. Radio Communications (3 TP) and Motorization (5 TP) each add +1 reinforcement — 8 TP buys both.',
  },
  {
    id: 'tt_complete',
    title: 'Tech Lesson Complete',
    message: 'You have researched a node and seen what it unlocks. In full games, plan a path toward the abilities your strategy needs.',
    variant: 'module_complete',
  },
];

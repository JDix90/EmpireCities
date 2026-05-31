import type { TutorialStep } from '../types';

export const TECH_TREE_STEPS: TutorialStep[] = [
  {
    id: 'tt_welcome',
    title: 'Technology Tree',
    message: 'This practice match has Tech Trees enabled. You earn technology points (TP) over time and spend them to unlock nodes with passive bonuses or new abilities.',
    detail: 'You start with bonus TP in this lesson so you can research immediately.',
  },
  {
    id: 'tt_points',
    title: 'Technology Points',
    message: 'Your TP balance is shown in the Tech Tree and on your player card. Income comes from era rules, certain buildings, and some faction passives.',
    whyItMatters: 'Saving for a tier-2 node is often better than buying every cheap tier-1.',
  },
  {
    id: 'tt_open',
    title: 'Open the Tech Tree',
    message: 'Open the tree to browse tiers, costs, and prerequisites. Locked nodes show what you must research first.',
    actionOpenTechTree: true,
    requireAction: 'tech_tree_opened',
    hint: 'Tap "Open Tech Tree" below. Your 8 bonus TP are already available.',
  },
  {
    id: 'tt_research',
    title: 'Research a Technology',
    message: 'Select an affordable tier-1 node and confirm research. Passives apply immediately; abilities appear on the territory panel when unlocked.',
    requireAction: 'tech_researched',
    hint: 'Pick a tier-1 node — Motorization, Bunker Network, or Radio Communications are strong first picks on WW2.',
  },
  {
    id: 'tt_complete',
    title: 'Tech Lesson Complete',
    message: 'You have researched a node and seen how bonuses stack. In full games, plan a path toward the abilities your strategy needs.',
    variant: 'module_complete',
  },
];

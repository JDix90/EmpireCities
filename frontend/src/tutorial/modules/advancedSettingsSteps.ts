import type { TutorialStep } from '../types';

export const ADVANCED_SETTINGS_STEPS: TutorialStep[] = [
  {
    id: 'as_welcome',
    title: 'Advanced Settings',
    message: 'Hosts tune each match in the lobby. You can mix eras, player counts, timers, and optional systems without changing the core Reinforce → Attack → Fortify loop.',
    hint: 'Mostly reading — press Next through each card. One card asks you to flip two options in the Settings Lab before you go on; try the rest in your next custom game.',
  },
  {
    id: 'as_timers',
    title: 'Turn Timers & Async',
    message: 'Live games use a turn timer (3, 5 or 10 minutes in a custom game, or none at all) so matches keep moving. Async games give each turn 12 hours, a day or three days instead — great for play-by-mail across time zones.',
    whyItMatters: 'Pick timers that match your group\'s attention span; async avoids abandons when someone is busy.',
  },
  {
    id: 'as_fog',
    title: 'Fog of War',
    message: 'Fog hides enemy unit counts everywhere except your own territories and the ones bordering them. You always see who owns each territory, and some technologies see further.',
    whyItMatters: 'Rewards keeping reserves back from the front, where enemies cannot count them.',
  },
  {
    id: 'as_economy',
    title: 'Economy & Buildings',
    message: 'Economy adds production points and constructible buildings (defense, production, wonders). Buildings modify dice, income, or special rules on their territory.',
    whyItMatters: 'Shifts focus from pure expansion to securing high-value production regions.',
  },
  {
    id: 'as_stacking',
    title: 'Stacking Features',
    message: 'Factions, tech trees, naval rules, events, and population stability can combine. Start with one optional system, then add another once your group knows the basics.',
    detail: 'Example progression: core only → +factions → +tech (which brings Economy & Buildings with it) → +events.',
  },
  {
    id: 'as_try_toggle',
    title: 'Try a Setting',
    message: 'Open the Settings Lab below and toggle at least two options. Your choices apply to this practice match — look for new UI in the sidebar after you close the lab.',
    messagePhone: 'Open the Settings Lab below and toggle at least two options. Your choices apply to this practice match — look for new UI under **☰ Menu** after you close the lab.',
    requireAction: 'settings_explored',
    actionOpenSettingsLab: true,
    hint: 'Press "Open Settings Lab", flip two toggles, then close the lab and check the sidebar.',
    hintPhone: 'Tap "Open Settings Lab", flip two toggles, then close the lab and check **☰ Menu**.',
    whyItMatters:
      'Experimenting before your first custom lobby means you already know which toggles matter for your group.',
  },
  {
    id: 'as_complete',
    title: 'Settings Lesson Complete',
    message: 'You have seen what the main options change. Create a custom game and add one new option at a time — there, Factions and Era Events are called Asymmetric Factions and Historical Events.',
    variant: 'module_complete',
  },
];

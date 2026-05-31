import type { TutorialStep } from '../types';

export const ADVANCED_SETTINGS_STEPS: TutorialStep[] = [
  {
    id: 'as_welcome',
    title: 'Advanced Settings',
    message: 'Hosts tune each match in the lobby. You can mix eras, player counts, timers, and optional systems without changing the core Draft → Attack → Fortify loop.',
    hint: 'This lesson is informational — tap Next through each card, then try these options in your next custom game.',
  },
  {
    id: 'as_timers',
    title: 'Turn Timers & Async',
    message: 'Live games use turn timers (e.g. 60–300 seconds) so matches keep moving. Async games replace the timer with a deadline — great for play-by-mail across time zones.',
    whyItMatters: 'Pick timers that match your group\'s attention span; async avoids abandons when someone is busy.',
  },
  {
    id: 'as_fog',
    title: 'Fog of War',
    message: 'Fog hides enemy unit counts on territories you have not recently scouted. Attacking reveals partial information; holding a territory gives clearer intel.',
    whyItMatters: 'Encourages probing attacks and bluffing weak borders.',
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
    detail: 'Example progression: core only → +factions → +tech → +events.',
  },
  {
    id: 'as_try_toggle',
    title: 'Try a Setting',
    message: 'Open the Settings Lab below and toggle at least two options. Your choices apply to this practice match — look for new UI in the sidebar after you close the lab.',
    requireAction: 'settings_explored',
    actionOpenSettingsLab: true,
    hint: 'Tap "Open Settings Lab", flip two toggles, then close the lab and check the sidebar.',
    whyItMatters:
      'Experimenting before your first custom lobby means you already know which toggles matter for your group.',
  },
  {
    id: 'as_complete',
    title: 'Settings Lesson Complete',
    message: 'You now know what each toggle changes. Create a custom lobby game and experiment with one new option at a time.',
    variant: 'module_complete',
  },
];

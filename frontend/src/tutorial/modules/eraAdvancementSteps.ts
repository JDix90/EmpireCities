import type { TutorialStep } from '../types';

/**
 * Era Advancement lesson. Runs on the Ancient map with the short PoC spine and
 * generous starting resources, so the player can research toward the gate and
 * advance to Medieval within a couple of turns.
 */
export const ERA_ADVANCEMENT_STEPS: TutorialStep[] = [
  {
    id: 'ea_welcome',
    title: 'Era Advancement',
    message: 'This match lets your civilization climb through the ages. You start in the **Ancient** era — research and build, then advance to **Medieval** for stronger units and a one-time payoff.',
    detail: 'You begin with bonus research points and gold so you can reach the advancement quickly.',
  },
  {
    id: 'ea_progress',
    title: 'Your Era & the Timeline',
    message: 'The Era panel in your sidebar shows the timeline of eras, your position on it, and the gate you must clear to advance. Opponents climb at their own pace.',
    whyItMatters: 'Advancing first earns an edge — but it briefly weakens your army, so timing matters.',
  },
  {
    id: 'ea_open_tree',
    title: 'Open the Tech Tree',
    message: 'Open the Tech Tree. A progress rail at the top shows exactly which technologies the advancement gate needs.',
    actionOpenTechTree: true,
    requireAction: 'tech_tree_opened',
    hint: 'Tap "Open Tech Tree" below. Your bonus research points are ready.',
  },
  {
    id: 'ea_research',
    title: 'Research Toward the Gate',
    message: 'Research an affordable tier-1 technology. Watch the gate chips at the top of the tree update as you go.',
    requireAction: 'tech_researched',
    hint: 'Pick any tier-1 node — the gate needs a couple of techs in total.',
  },
  {
    id: 'ea_gate',
    title: 'Clear the Gate',
    message: 'Keep researching until every gate chip turns green — the gate needs a few technologies and enough gold (you already have plenty). The Advance Era button lights up when you are ready.',
    detail: 'Tier-2 nodes need their tier-1 prerequisite first, so research the parent, then the tier-2.',
    whyItMatters: 'The same gate exists in real games — but there you also balance buildings and stability.',
  },
  {
    id: 'ea_advance',
    title: 'Advance to Medieval',
    message: 'Your gate is clear — open the Era panel and use **Advance Era**. Your units carry forward, your tech resets to the new era, and you gain a signature payoff.',
    requireAction: 'era_advanced',
    hint: 'Find the Era Advancement panel in your sidebar and press Advance.',
  },
  {
    id: 'ea_signature',
    title: 'Vulnerable, but Stronger',
    message: 'You are now Medieval. For one turn your defense is weaker — the vulnerability window — but you gained the era\'s signature reward and a fresh, stronger tech tree.',
    whyItMatters: 'Plan advances when you are safe from attack, and spend your signature before it lapses.',
  },
  {
    id: 'ea_complete',
    title: 'Era Advancement Complete',
    message: 'You climbed an era: cleared a gate, advanced, and weathered the vulnerability window. In full games the spine runs all the way to the Modern era.',
    variant: 'module_complete',
  },
];

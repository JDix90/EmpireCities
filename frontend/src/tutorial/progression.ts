import { ADVANCED_SETTINGS_STEPS } from './modules/advancedSettingsSteps';
import { FACTION_ABILITY_STEPS } from './modules/factionAbilitySteps';
import { TECH_TREE_STEPS } from './modules/techTreeSteps';
import { ERA_ADVANCEMENT_STEPS } from './modules/eraAdvancementSteps';
import { COMBINED_CORE_TUTORIAL_STEPS } from './modules/combinedCoreSteps';
import type { TutorialLessonModule, TutorialRequireAction, TutorialStep } from './types';
import { TUTORIAL_V2_ENABLED } from './types';
import { api } from '../services/api';

const STORAGE_KEY = 'borderfall_tutorial_modules_completed_v2';

export function getTutorialSteps(module: TutorialLessonModule): TutorialStep[] {
  switch (module) {
    case 'advanced_settings':
      return ADVANCED_SETTINGS_STEPS;
    case 'faction_ability':
      return FACTION_ABILITY_STEPS;
    case 'tech_tree':
      return TECH_TREE_STEPS;
    case 'era_advancement':
      return ERA_ADVANCEMENT_STEPS;
    case 'core':
    default:
      return COMBINED_CORE_TUTORIAL_STEPS;
  }
}

export function getCompletedTutorialModules(): TutorialLessonModule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is TutorialLessonModule =>
      ['core', 'advanced_settings', 'faction_ability', 'tech_tree', 'era_advancement'].includes(m as string),
    );
  } catch {
    return [];
  }
}

export function markTutorialModuleComplete(module: TutorialLessonModule): void {
  const set = new Set(getCompletedTutorialModules());
  set.add(module);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota */
  }
  // Best-effort server sync — fire and forget, no UI block.
  api.post(`/users/me/tutorial-modules/${module}`).catch(() => { /* degrade gracefully */ });
}

/**
 * Called after /api/users/me loads. Merges the server's completed modules into
 * localStorage so progress is consistent across devices.
 */
export function mergeServerTutorialModules(serverModules: string[]): void {
  const local = new Set(getCompletedTutorialModules());
  let changed = false;
  for (const mod of serverModules) {
    if (['core', 'advanced_settings', 'faction_ability', 'tech_tree', 'era_advancement'].includes(mod) && !local.has(mod as TutorialLessonModule)) {
      local.add(mod as TutorialLessonModule);
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...local]));
  } catch {
    /* ignore quota */
  }
}

export function getRecommendedTutorialModule(): TutorialLessonModule | null {
  if (!TUTORIAL_V2_ENABLED) return null;
  const done = new Set(getCompletedTutorialModules());
  if (!done.has('advanced_settings')) return 'advanced_settings';
  if (!done.has('faction_ability')) return 'faction_ability';
  if (!done.has('tech_tree')) return 'tech_tree';
  if (!done.has('era_advancement')) return 'era_advancement';
  return null;
}

/**
 * Step IDs that use centered overlay layout (read-heavy cards). Ids are listed
 * across every lesson module, so this set is intentionally larger than any one
 * module's step list.
 */
export function isTutorialStepCentered(step: TutorialStep | undefined): boolean {
  if (!step) return false;
  if (step.variant === 'wrapup' || step.variant === 'module_complete') return true;
  const centeredIds = new Set([
    'welcome',
    'economy_intro',
    'as_welcome',
    'as_timers',
    'as_fog',
    'as_economy',
    'as_stacking',
    'as_try_toggle',
    'as_complete',
    'fa_welcome',
    'fa_identity',
    'fa_when',
    'fa_result',
    'fa_complete',
    'tt_welcome',
    'tt_points',
    'tt_open',
    'tt_complete',
    'ea_welcome',
    'ea_progress',
    'ea_gate',
    'ea_signature',
    'ea_complete',
  ]);
  return centeredIds.has(step.id);
}

/**
 * Is the `my_turn` gate satisfied right now?
 *
 * Deliberately a state check, not an edge. It used to fire only on the
 * transition INTO the viewer's turn, which stranded the tutorial whenever the
 * step arrived after that transition had already happened — and it routinely
 * does: steps 4–7 each wait on a phase change, there are only three per turn,
 * so the step index lags the board. `opponent_turn` then became current during
 * the player's OWN turn and sat there telling them to watch the opponent until
 * the turn after next. Asking "is it my turn" instead is satisfied immediately
 * in that case, and is identical to the edge check in the normal flow — the
 * player cannot reach this step during their own turn without having watched
 * the opponent's.
 */
export function isMyTurnGateSatisfied(args: {
  myPlayerId: string | null;
  players: Array<{ player_id: string }>;
  currentPlayerIndex: number;
}): boolean {
  if (!args.myPlayerId) return false;
  return args.players[args.currentPlayerIndex]?.player_id === args.myPlayerId;
}

export function shouldAdvanceTutorialOnState(args: {
  step: TutorialStep | undefined;
  prevPhase: string | null;
  nextPhase: string;
  playerChanged: boolean;
  prevPlayerIndex: number | null;
  newPlayerIndex: number;
  myPlayerId: string | null;
  players: Array<{ player_id: string }>;
  isMyDraftTurn: boolean;
  draftLeft: number;
}): boolean {
  const { step } = args;
  if (!step?.requireAction) return false;

  if (step.requireAction === 'my_turn') {
    return isMyTurnGateSatisfied({
      myPlayerId: args.myPlayerId,
      players: args.players,
      currentPlayerIndex: args.newPlayerIndex,
    });
  }

  if (step.requireAction === 'draft') {
    return args.nextPhase === 'attack' || (args.isMyDraftTurn && args.draftLeft === 0);
  }

  if (step.requireAction === 'end_phase' && args.prevPhase && args.prevPhase !== args.nextPhase) {
    return true;
  }

  return false;
}

export function isActionOnlyRequireAction(action: TutorialRequireAction | undefined): boolean {
  return (
    action === 'draft' ||
    action === 'end_phase' ||
    action === 'my_turn' ||
    action === 'tech_researched' ||
    action === 'ability_used' ||
    action === 'settings_explored' ||
    action === 'bonuses_opened' ||
    action === 'tech_tree_opened' ||
    action === 'era_advanced'
  );
}

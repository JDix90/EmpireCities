import { ADVANCED_SETTINGS_STEPS } from './modules/advancedSettingsSteps';
import { CORE_TUTORIAL_STEPS } from './modules/coreSteps';
import { FACTION_ABILITY_STEPS } from './modules/factionAbilitySteps';
import { TECH_TREE_STEPS } from './modules/techTreeSteps';
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
    case 'core':
    default: {
      if (TUTORIAL_V2_ENABLED) return CORE_TUTORIAL_STEPS;
      return CORE_TUTORIAL_STEPS.filter(
        (s) => !['advanced_settings_primer', 'ability_primer', 'tech_primer'].includes(s.id),
      );
    }
  }
}

export function getCompletedTutorialModules(): TutorialLessonModule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is TutorialLessonModule =>
      ['core', 'advanced_settings', 'faction_ability', 'tech_tree'].includes(m as string),
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
    if (['core', 'advanced_settings', 'faction_ability', 'tech_tree'].includes(mod) && !local.has(mod as TutorialLessonModule)) {
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
  return null;
}

/** Step IDs that use centered overlay layout (read-heavy cards). */
export function isTutorialStepCentered(step: TutorialStep | undefined): boolean {
  if (!step) return false;
  if (step.variant === 'wrapup' || step.variant === 'module_complete') return true;
  const centeredIds = new Set([
    'welcome',
    'draft_explain',
    'cards_explain',
    'victory_explain',
    'settings_overview',
    'advanced_settings_primer',
    'ability_primer',
    'tech_primer',
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
  ]);
  return centeredIds.has(step.id);
}

/**
 * Previously auto-advanced game phases to match tutorial steps.
 * The core tutorial now teaches players to click the HUD phase buttons themselves
 * via the `advance_draft` step (end_phase) and `attack_do` / `fortify_explain`
 * steps (end_phase). This function is kept for call-site compatibility but
 * always returns false.
 * @deprecated No longer used — all phase transitions are player-driven.
 */
export function tutorialStepNeedsPhaseAssist(_stepId: string | undefined): {
  advanceDraftToAttack: boolean;
  advanceAttackToFortify: boolean;
  autoEndFortify: boolean;
  autoAdvanceAttackAfterCombat: boolean;
} {
  return {
    advanceDraftToAttack: false,
    advanceAttackToFortify: false,
    autoEndFortify: false,
    autoAdvanceAttackAfterCombat: false,
  };
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

  if (step.requireAction === 'my_turn' && args.playerChanged && args.prevPlayerIndex !== null && args.myPlayerId) {
    const prevPid = args.players[args.prevPlayerIndex]?.player_id;
    const nowPid = args.players[args.newPlayerIndex]?.player_id;
    return prevPid !== args.myPlayerId && nowPid === args.myPlayerId;
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
    action === 'tech_tree_opened'
  );
}

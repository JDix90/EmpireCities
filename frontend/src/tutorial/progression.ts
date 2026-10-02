import { ADVANCED_SETTINGS_STEPS } from './modules/advancedSettingsSteps';
import { FACTION_ABILITY_STEPS } from './modules/factionAbilitySteps';
import { TECH_TREE_STEPS } from './modules/techTreeSteps';
import { ERA_ADVANCEMENT_STEPS } from './modules/eraAdvancementSteps';
import { COMBINED_CORE_TUTORIAL_STEPS } from './modules/combinedCoreSteps';
import { GALAXY_PRIMER_STEPS } from './modules/galaxyPrimerSteps';
import { GALAXY_LANE_SOVEREIGNTY_STEPS } from './modules/galaxyLaneSovereigntySteps';
import { GALAXY_TRANSCENDENCE_STEPS } from './modules/galaxyTranscendenceSteps';
import { GALAXY_SECRET_MISSIONS_STEPS } from './modules/galaxySecretMissionsSteps';
import { GALAXY_CAPITAL_STEPS } from './modules/galaxyCapitalSteps';
import { GALAXY_THRESHOLD_STEPS } from './modules/galaxyThresholdSteps';
import { GALAXY_DOMINATION_STEPS } from './modules/galaxyDominationSteps';
import type { TutorialLessonModule, TutorialRequireAction, TutorialStep } from './types';
import {
  CORE_TUTORIAL_MODULE_IDS,
  GALAXY_TUTORIAL_MODULE_IDS,
  TUTORIAL_V2_ENABLED,
  isTutorialLessonModule,
} from './types';
import { api } from '../services/api';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

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
    case 'galaxy_primer':
      return GALAXY_PRIMER_STEPS;
    case 'galaxy_lane_sovereignty':
      return GALAXY_LANE_SOVEREIGNTY_STEPS;
    case 'galaxy_transcendence':
      return GALAXY_TRANSCENDENCE_STEPS;
    case 'galaxy_secret_missions':
      return GALAXY_SECRET_MISSIONS_STEPS;
    case 'galaxy_capital':
      return GALAXY_CAPITAL_STEPS;
    case 'galaxy_threshold':
      return GALAXY_THRESHOLD_STEPS;
    case 'galaxy_domination':
      return GALAXY_DOMINATION_STEPS;
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
    return parsed.filter((m): m is TutorialLessonModule => isTutorialLessonModule(m));
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
    if (isTutorialLessonModule(mod) && !local.has(mod)) {
      local.add(mod);
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

/**
 * The next lesson to suggest: the first deep dive not yet done, in Academy
 * order, then — once every core lesson is done and the galaxy track is open —
 * the first galaxy lesson not yet done. `galaxyEnabled` defaults to the live
 * flag; tests pass it explicitly.
 */
export function getRecommendedTutorialModule(
  opts: { galaxyEnabled?: boolean } = {},
): TutorialLessonModule | null {
  if (!TUTORIAL_V2_ENABLED) return null;
  const done = new Set(getCompletedTutorialModules());
  for (const mod of CORE_TUTORIAL_MODULE_IDS) {
    if (mod === 'core') continue; // the Academy's own primary card, never "recommended next"
    if (!done.has(mod)) return mod;
  }
  const galaxyEnabled = opts.galaxyEnabled ?? useFeatureFlagsStore.getState().flags.galaxy_tutorial_enabled;
  if (!galaxyEnabled) return null;
  for (const mod of GALAXY_TUTORIAL_MODULE_IDS) {
    if (!done.has(mod)) return mod;
  }
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
    'gpr_welcome',
    'gpr_worlds',
    'gpr_boards',
    'gpr_lanes',
    'gpr_wins',
    'gls_welcome',
    'gtr_welcome',
    'gsm_welcome',
    'gsm_alliance',
    'gcp_welcome',
    'gcp_rules',
    'gth_welcome',
    'gth_meter',
    'gdm_welcome',
    'gdm_rules',
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
  /** The viewer's own secret mission reads complete on the board they can see. */
  ownMissionComplete?: boolean;
}): boolean {
  const { step } = args;
  if (!step?.requireAction) return false;

  if (step.requireAction === 'mission_complete') return args.ownMissionComplete === true;

  if (step.requireAction === 'my_turn') {
    return isMyTurnGateSatisfied({
      myPlayerId: args.myPlayerId,
      players: args.players,
      currentPlayerIndex: args.newPlayerIndex,
    });
  }

  // The turn coming back round: an edge, so a card can sit through the
  // player's own phases and advance only once the rivals have played.
  if (step.requireAction === 'my_next_turn') {
    return args.playerChanged && isMyTurnGateSatisfied({
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

/**
 * Whether the viewer's own secret mission reads complete from the board they
 * can see: a capture mission with every named system held. The server judges
 * the win (from round 2); this only tells a card the player has done their
 * part. Other mission kinds answer false — a lesson gating on this deals a
 * capture mission.
 */
export function isOwnMissionVisiblyComplete(args: {
  mission: { kind: string; territory_ids?: string[] } | null | undefined;
  myPlayerId: string | null;
  territories: Record<string, { owner_id: string | null }>;
}): boolean {
  const { mission, myPlayerId, territories } = args;
  if (!mission || !myPlayerId || mission.kind !== 'capture_territories') return false;
  const ids = mission.territory_ids ?? [];
  return ids.length > 0 && ids.every((id) => territories[id]?.owner_id === myPlayerId);
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
    action === 'era_advanced' ||
    action === 'my_next_turn' ||
    action === 'territory_captured' ||
    action === 'building_built' ||
    action === 'wonder_built' ||
    action === 'galaxy_chart_opened' ||
    action === 'mission_complete' ||
    action === 'game_won'
  );
}

import type { GameState } from '../../types';
import { getPlayerReinforceBonus } from '../state/techManager';

export type TutorialLabSettingsInput = {
  fog_of_war?: boolean;
  factions_enabled?: boolean;
  tech_trees_enabled?: boolean;
  economy_enabled?: boolean;
  events_enabled?: boolean;
  diplomacy_enabled?: boolean;
};

const SETTING_LABELS: Record<keyof TutorialLabSettingsInput, string> = {
  fog_of_war: 'Fog of War',
  factions_enabled: 'Factions',
  tech_trees_enabled: 'Technology Tree',
  economy_enabled: 'Economy & Buildings',
  events_enabled: 'Era Events',
  diplomacy_enabled: 'Diplomacy',
};

/**
 * Apply Settings Lab choices to a live advanced-settings tutorial match.
 * Returns human-readable labels for settings that ended up enabled.
 */
export function applyTutorialSettingsLab(
  state: GameState,
  lab: TutorialLabSettingsInput,
): string[] {
  if (!state.settings.tutorial || state.settings.tutorial_lesson_module !== 'advanced_settings') {
    return [];
  }

  const enabledLabels: string[] = [];
  const human = state.players.find((p) => !p.is_ai);
  const ai = state.players.find((p) => p.is_ai);

  if (typeof lab.fog_of_war === 'boolean') {
    state.settings.fog_of_war = lab.fog_of_war;
    if (lab.fog_of_war) enabledLabels.push(SETTING_LABELS.fog_of_war);
  }

  if (typeof lab.diplomacy_enabled === 'boolean') {
    state.settings.diplomacy_enabled = lab.diplomacy_enabled;
    if (lab.diplomacy_enabled) enabledLabels.push(SETTING_LABELS.diplomacy_enabled);
  }

  if (typeof lab.events_enabled === 'boolean') {
    state.settings.events_enabled = lab.events_enabled || undefined;
    if (lab.events_enabled) enabledLabels.push(SETTING_LABELS.events_enabled);
  }

  if (typeof lab.tech_trees_enabled === 'boolean' && lab.tech_trees_enabled) {
    state.settings.tech_trees_enabled = true;
    enabledLabels.push(SETTING_LABELS.tech_trees_enabled);
    for (const player of state.players) {
      if (player.tech_points == null) player.tech_points = 0;
      if (!player.unlocked_techs) player.unlocked_techs = [];
    }
    if (human) {
      human.tech_points = Math.max(human.tech_points ?? 0, 8);
    }
  } else if (lab.tech_trees_enabled === false) {
    state.settings.tech_trees_enabled = undefined;
  }

  if (typeof lab.economy_enabled === 'boolean' && lab.economy_enabled) {
    state.settings.economy_enabled = true;
    enabledLabels.push(SETTING_LABELS.economy_enabled);
    for (const territory of Object.values(state.territories)) {
      if (!territory.buildings) territory.buildings = [];
    }
    if (human && (human.special_resource == null || human.special_resource === 0)) {
      human.special_resource = 10;
    }
  } else if (lab.economy_enabled === false) {
    state.settings.economy_enabled = undefined;
  }

  if (typeof lab.factions_enabled === 'boolean' && lab.factions_enabled) {
    state.settings.factions_enabled = true;
    enabledLabels.push(SETTING_LABELS.factions_enabled);
    if (human && !human.faction_id) human.faction_id = 'usa';
    if (ai && !ai.faction_id) ai.faction_id = 'germany';
    // Faction passives may change draft pool for the current turn.
    if (human && state.phase === 'draft') {
      state.draft_units_remaining += getPlayerReinforceBonus(state, human.player_id);
    }
  } else if (lab.factions_enabled === false) {
    state.settings.factions_enabled = undefined;
  }

  state.settings.tutorial_settings_lab_applied = true;
  return enabledLabels;
}

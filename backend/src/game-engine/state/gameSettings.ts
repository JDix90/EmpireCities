import type { GameSettings, VictoryType } from '../../types';
import {
  DEFAULT_ECONOMY_TECH_STARTING_GOLD,
  DEFAULT_ECONOMY_TECH_STARTING_TECH_POINTS,
  getDefaultEraAdvancementSettings,
} from '../eraAdvancement/constants';
import { isValidSpineId } from '../eraAdvancement/spines';
import { applyEraAdvancementPreset, isEraAdvancementPreset } from '../eraAdvancement/presets';
import { getDefaultGameSettingsConfig } from '../../services/adminConfig';

const VICTORY_TYPES: VictoryType[] = ['domination', 'secret_mission', 'capital', 'threshold', 'transcendence'];

const TUTORIAL_LESSON_MODULES = ['core', 'advanced_settings', 'faction_ability', 'tech_tree', 'era_advancement'] as const;

function isVictoryType(v: unknown): v is VictoryType {
  return typeof v === 'string' && (VICTORY_TYPES as readonly string[]).includes(v);
}

function isTutorialLessonModule(v: unknown): v is (typeof TUTORIAL_LESSON_MODULES)[number] {
  return typeof v === 'string' && (TUTORIAL_LESSON_MODULES as readonly string[]).includes(v);
}

/**
 * Merge legacy `victory_type` with `allowed_victory_conditions`.
 * Old snapshots only have `victory_type`; new games use `allowed_victory_conditions`.
 */
export function normalizeGameSettings(raw: Partial<GameSettings>): GameSettings {
  const defaults = getDefaultGameSettingsConfig();
  const fog = typeof raw.fog_of_war === 'boolean' ? raw.fog_of_war : false;
  const turnTimer = typeof raw.turn_timer_seconds === 'number' && !Number.isNaN(raw.turn_timer_seconds)
    ? raw.turn_timer_seconds
    : defaults.turn_timer_seconds;
  const initialUnits = typeof raw.initial_unit_count === 'number' && raw.initial_unit_count >= 1
    ? raw.initial_unit_count
    : defaults.initial_unit_count;
  const cardEsc = typeof raw.card_set_escalating === 'boolean' ? raw.card_set_escalating : true;
  const dip = typeof raw.diplomacy_enabled === 'boolean' ? raw.diplomacy_enabled : true;
  const factionsEnabled = typeof raw.factions_enabled === 'boolean' ? raw.factions_enabled : false;
  const economyEnabled = typeof raw.economy_enabled === 'boolean' ? raw.economy_enabled : false;
  const techTreesEnabled = typeof raw.tech_trees_enabled === 'boolean' ? raw.tech_trees_enabled : false;
  const eventsEnabled = typeof raw.events_enabled === 'boolean' ? raw.events_enabled : false;
  // Impact scaling is on by default whenever events are; only an explicit
  // `false` opts out (kept verbatim so the disable survives normalization).
  const eventImpactScalingEnabled =
    typeof raw.event_impact_scaling_enabled === 'boolean' ? raw.event_impact_scaling_enabled : true;
  const navalEnabled = typeof raw.naval_enabled === 'boolean' ? raw.naval_enabled : false;
  const stabilityEnabled = typeof raw.stability_enabled === 'boolean' ? raw.stability_enabled : false;
  const territorySelection = typeof raw.territory_selection === 'boolean' ? raw.territory_selection : false;
  const coachingEnabled = typeof raw.coaching_enabled === 'boolean' ? raw.coaching_enabled : false;
  // Combat dice cap (anti-fortress). Off by default. When on, clamp the configured
  // ceilings to never drop below the natural base (attacker 3, defender 2) so a
  // misconfigured low cap can't weaken vanilla combat.
  const combatDiceCapEnabled = typeof raw.combat_dice_cap_enabled === 'boolean' ? raw.combat_dice_cap_enabled : false;
  // Galaxy contestable hyperspace lanes (lane seals). Off by default — real rule change.
  const lanesContestableEnabled = typeof raw.lanes_contestable_enabled === 'boolean' ? raw.lanes_contestable_enabled : false;
  // Standalone Space Age frontier seeding. Off by default — baked at create from
  // the space_age_frontiers_enabled feature flag; no-op off space_age.
  const spaceAgeFrontiersEnabled = typeof raw.space_age_frontiers_enabled === 'boolean' ? raw.space_age_frontiers_enabled : false;
  // Galaxy per-world identity modifiers. ON by default (no-op unless the map
  // authors worlds[].modifiers); a lobby toggle can disable it.
  const worldModifiersEnabled = typeof raw.world_modifiers_enabled === 'boolean' ? raw.world_modifiers_enabled : true;
  const eraDefaults = getDefaultEraAdvancementSettings();
  const eraAdvancementEnabled = typeof raw.era_advancement_enabled === 'boolean'
    ? raw.era_advancement_enabled
    : eraDefaults.era_advancement_enabled;
  // Resolve a lobby preset into concrete era settings (explicit knobs still win)
  // before normalizing, so the rest of the function reads the merged values.
  if (eraAdvancementEnabled) {
    raw = applyEraAdvancementPreset(raw);
  }
  const eraPreset = isEraAdvancementPreset(raw.era_advancement_preset)
    ? raw.era_advancement_preset
    : undefined;
  const numSetting = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  // Async mode: auto-detect from long turn timers (≥12 hours)
  const VALID_ASYNC_DEADLINES = [43200, 86400, 259200]; // 12h, 24h, 72h
  const explicitAsync = typeof raw.async_mode === 'boolean' ? raw.async_mode : false;
  const asyncMode = explicitAsync || turnTimer >= 43200;
  let asyncDeadlineSeconds: number | undefined;
  if (asyncMode) {
    if (typeof raw.async_turn_deadline_seconds === 'number' && VALID_ASYNC_DEADLINES.includes(raw.async_turn_deadline_seconds)) {
      asyncDeadlineSeconds = raw.async_turn_deadline_seconds;
    } else if (VALID_ASYNC_DEADLINES.includes(turnTimer)) {
      asyncDeadlineSeconds = turnTimer;
    } else {
      asyncDeadlineSeconds = 86400; // default 24h
    }
  }

  let allowed: VictoryType[];
  const fromArr = raw.allowed_victory_conditions;
  if (Array.isArray(fromArr)) {
    if (fromArr.length === 0) {
      allowed = [];
    } else {
      allowed = [...new Set(fromArr.filter(isVictoryType))];
      if (allowed.length === 0) allowed = ['domination'];
    }
  } else if (isVictoryType(raw.victory_type)) {
    allowed = [raw.victory_type];
  } else {
    allowed = ['domination'];
  }

  const vt: VictoryType = allowed[0] ?? 'domination';
  let threshold: number | undefined;
  if (typeof raw.victory_threshold === 'number' && Number.isFinite(raw.victory_threshold)) {
    threshold = Math.max(1, Math.min(99, Math.floor(raw.victory_threshold)));
  }

  const base: GameSettings = {
    fog_of_war: fog,
    victory_type: vt,
    allowed_victory_conditions: allowed,
    victory_threshold: threshold,
    max_turns:
      typeof raw.max_turns === 'number' && Number.isInteger(raw.max_turns) && raw.max_turns >= 10
        ? raw.max_turns
        : null,
    turn_timer_seconds: turnTimer,
    initial_unit_count: initialUnits,
    card_set_escalating: cardEsc,
    diplomacy_enabled: dip,
    tutorial: typeof raw.tutorial === 'boolean' ? raw.tutorial : undefined,
    tutorial_step: typeof raw.tutorial_step === 'number' ? raw.tutorial_step : undefined,
    tutorial_lesson_module: isTutorialLessonModule(raw.tutorial_lesson_module)
      ? raw.tutorial_lesson_module
      : undefined,
    tutorial_grant_tech_points:
      typeof raw.tutorial_grant_tech_points === 'number' && raw.tutorial_grant_tech_points > 0
        ? raw.tutorial_grant_tech_points
        : undefined,
    tutorial_settings_lab_applied:
      typeof raw.tutorial_settings_lab_applied === 'boolean'
        ? raw.tutorial_settings_lab_applied
        : undefined,
    async_mode: asyncMode || undefined,
    async_turn_deadline_seconds: asyncDeadlineSeconds,
    factions_enabled: factionsEnabled || undefined,
    economy_enabled: economyEnabled || undefined,
    tech_trees_enabled: techTreesEnabled || undefined,
    economy_tech_starting_tech_points:
      economyEnabled && techTreesEnabled
        ? numSetting(raw.economy_tech_starting_tech_points, DEFAULT_ECONOMY_TECH_STARTING_TECH_POINTS)
        : undefined,
    economy_tech_starting_gold:
      economyEnabled && techTreesEnabled
        ? numSetting(raw.economy_tech_starting_gold, DEFAULT_ECONOMY_TECH_STARTING_GOLD)
        : undefined,
    events_enabled: eventsEnabled || undefined,
    // Persist false explicitly so the opt-out sticks; omit when events are off
    // or scaling is left at its default-on.
    event_impact_scaling_enabled:
      eventsEnabled && !eventImpactScalingEnabled ? false : undefined,
    naval_enabled: navalEnabled || undefined,
    stability_enabled: stabilityEnabled || undefined,
    territory_selection: territorySelection || undefined,
    coaching_enabled: coachingEnabled || undefined,
    era_advancement_enabled: eraAdvancementEnabled || undefined,
    era_advancement_preset: eraAdvancementEnabled ? eraPreset : undefined,
    era_advancement_spine_id: eraAdvancementEnabled
      ? (isValidSpineId(raw.era_advancement_spine_id) ? raw.era_advancement_spine_id : eraDefaults.era_advancement_spine_id)
      : undefined,
    // Board-transform model: advancing eras swaps the whole board to the next
    // era's map (vs. growth-style frontier unlocks). Only meaningful with era
    // advancement on; defaults off so existing games keep growth behavior.
    era_advancement_board_transform:
      eraAdvancementEnabled && raw.era_advancement_board_transform === true ? true : undefined,
    era_advancement_conversion_ratio: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_conversion_ratio, eraDefaults.era_advancement_conversion_ratio)
      : undefined,
    era_advancement_strength_step: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_strength_step, eraDefaults.era_advancement_strength_step)
      : undefined,
    era_advancement_cost_step: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_cost_step, eraDefaults.era_advancement_cost_step)
      : undefined,
    era_advancement_cost_mult: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_cost_mult, eraDefaults.era_advancement_cost_mult)
      : undefined,
    era_advancement_cost_escalation: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_cost_escalation, eraDefaults.era_advancement_cost_escalation)
      : undefined,
    era_advancement_cost_escalation_cap: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_cost_escalation_cap, eraDefaults.era_advancement_cost_escalation_cap)
      : undefined,
    era_advancement_cost_income_floor: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_cost_income_floor, eraDefaults.era_advancement_cost_income_floor)
      : undefined,
    era_advancement_stability_gate: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_stability_gate, eraDefaults.era_advancement_stability_gate)
      : undefined,
    era_advancement_tech_gate_pct: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_tech_gate_pct, eraDefaults.era_advancement_tech_gate_pct)
      : undefined,
    era_advancement_tech_gate_mode: eraAdvancementEnabled
      ? (raw.era_advancement_tech_gate_mode === 'percent' ? 'percent' : 'milestone')
      : undefined,
    era_advancement_min_tier1_techs: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_min_tier1_techs, eraDefaults.era_advancement_min_tier1_techs)
      : undefined,
    era_advancement_min_tier2_techs: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_min_tier2_techs, eraDefaults.era_advancement_min_tier2_techs)
      : undefined,
    era_advancement_min_tier3_techs: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_min_tier3_techs, eraDefaults.era_advancement_min_tier3_techs)
      : undefined,
    era_advancement_min_buildings: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_min_buildings, eraDefaults.era_advancement_min_buildings)
      : undefined,
    era_advancement_vuln_defense_mult: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_vuln_defense_mult, eraDefaults.era_advancement_vuln_defense_mult)
      : undefined,
    era_advancement_vuln_turns: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_vuln_turns, eraDefaults.era_advancement_vuln_turns)
      : undefined,
    // Left undefined unless explicitly capped: getMaxEraIndex then bounds it by
    // the resolved spine length, so the classic spine reaches Modern while the
    // PoC spine stays at Medieval. Legacy saves carry an explicit 1.
    era_advancement_max_era_index: eraAdvancementEnabled && typeof raw.era_advancement_max_era_index === 'number'
      ? raw.era_advancement_max_era_index
      : undefined,
    era_advancement_combat_gap_dice: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_combat_gap_dice, eraDefaults.era_advancement_combat_gap_dice)
      : undefined,
    // Provide-only: absent means no anti-steamroll cap (preserves existing balance).
    era_advancement_max_lead: eraAdvancementEnabled && typeof raw.era_advancement_max_lead === 'number'
      ? raw.era_advancement_max_lead
      : undefined,
    era_advancement_catchup_discount: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_catchup_discount, eraDefaults.era_advancement_catchup_discount)
      : undefined,
    era_advancement_catchup_discount_floor: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_catchup_discount_floor, eraDefaults.era_advancement_catchup_discount_floor)
      : undefined,
    era_advancement_echo_decay: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_echo_decay, eraDefaults.era_advancement_echo_decay)
      : undefined,
    era_advancement_echo_cap_attack: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_echo_cap_attack, eraDefaults.era_advancement_echo_cap_attack)
      : undefined,
    era_advancement_echo_cap_defense: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_echo_cap_defense, eraDefaults.era_advancement_echo_cap_defense)
      : undefined,
    era_advancement_echo_cap_reinforce: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_echo_cap_reinforce, eraDefaults.era_advancement_echo_cap_reinforce)
      : undefined,
    era_advancement_echo_cap_tech: eraAdvancementEnabled
      ? numSetting(raw.era_advancement_echo_cap_tech, eraDefaults.era_advancement_echo_cap_tech)
      : undefined,
    // Galaxy contestable lanes — only persisted when explicitly enabled.
    lanes_contestable_enabled: lanesContestableEnabled || undefined,
    // Standalone Space Age frontier seeding — persisted only when explicitly enabled.
    space_age_frontiers_enabled: spaceAgeFrontiersEnabled || undefined,
    // Galaxy per-world identity — persisted only when explicitly disabled (default on).
    world_modifiers_enabled: worldModifiersEnabled ? undefined : false,
    // Anti-fortress dice cap — only persisted when explicitly enabled.
    combat_dice_cap_enabled: combatDiceCapEnabled || undefined,
    combat_max_attacker_dice: combatDiceCapEnabled
      ? Math.max(3, Math.floor(numSetting(raw.combat_max_attacker_dice, 5)))
      : undefined,
    combat_max_defender_dice: combatDiceCapEnabled
      ? Math.max(2, Math.floor(numSetting(raw.combat_max_defender_dice, 4)))
      : undefined,
  };

  // Preserve extensions not part of the normalized core (campaign, daily puzzle, lobby).
  const ext = raw as Partial<GameSettings>;
  return {
    ...base,
    is_campaign: ext.is_campaign,
    campaign_prestige_bonus: ext.campaign_prestige_bonus,
    campaign_path_id: ext.campaign_path_id,
    campaign_locked_faction: ext.campaign_locked_faction,
    campaign_carry: ext.campaign_carry,
    daily_challenge_date: typeof ext.daily_challenge_date === 'string' ? ext.daily_challenge_date : undefined,
    daily_challenge_spec: ext.daily_challenge_spec && typeof ext.daily_challenge_spec === 'object'
      ? ext.daily_challenge_spec
      : undefined,
    seed: typeof ext.seed === 'number' ? ext.seed : undefined,
    max_players: typeof ext.max_players === 'number' ? ext.max_players : undefined,
    economy_snapshot: ext.economy_snapshot && typeof ext.economy_snapshot === 'object' ? ext.economy_snapshot : undefined,
    xp_snapshot: ext.xp_snapshot && typeof ext.xp_snapshot === 'object' ? ext.xp_snapshot : undefined,
    // Galaxy per-world identity snapshot, written by createInitialGameState from
    // the map's worlds[] (never user input — the create API whitelist doesn't
    // admit it). It must survive re-normalization: repairLegacyGameState runs
    // normalizeGameSettings on every room load, which used to wipe it and turn
    // all live galaxy world modifiers off while sims kept them.
    world_modifiers:
      worldModifiersEnabled && ext.world_modifiers && typeof ext.world_modifiers === 'object'
        ? ext.world_modifiers
        : undefined,
  };
}

export function getAllowedVictoryConditions(settings: GameSettings): VictoryType[] {
  if (settings.allowed_victory_conditions && settings.allowed_victory_conditions.length > 0) {
    return settings.allowed_victory_conditions;
  }
  if (Array.isArray(settings.allowed_victory_conditions) && settings.allowed_victory_conditions.length === 0) {
    return [];
  }
  return [settings.victory_type ?? 'domination'];
}

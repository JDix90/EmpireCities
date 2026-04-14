import type { GameSettings, VictoryType } from '../../types';

const VICTORY_TYPES: VictoryType[] = ['domination', 'secret_mission', 'capital', 'threshold'];

function isVictoryType(v: unknown): v is VictoryType {
  return typeof v === 'string' && (VICTORY_TYPES as readonly string[]).includes(v);
}

/**
 * Merge legacy `victory_type` with `allowed_victory_conditions`.
 * Old snapshots only have `victory_type`; new games use `allowed_victory_conditions`.
 */
export function normalizeGameSettings(raw: Partial<GameSettings>): GameSettings {
  const fog = typeof raw.fog_of_war === 'boolean' ? raw.fog_of_war : false;
  const turnTimer = typeof raw.turn_timer_seconds === 'number' && !Number.isNaN(raw.turn_timer_seconds)
    ? raw.turn_timer_seconds
    : 300;
  const initialUnits = typeof raw.initial_unit_count === 'number' && raw.initial_unit_count >= 1
    ? raw.initial_unit_count
    : 3;
  const cardEsc = typeof raw.card_set_escalating === 'boolean' ? raw.card_set_escalating : true;
  const dip = typeof raw.diplomacy_enabled === 'boolean' ? raw.diplomacy_enabled : true;
  const factionsEnabled = typeof raw.factions_enabled === 'boolean' ? raw.factions_enabled : false;
  const economyEnabled = typeof raw.economy_enabled === 'boolean' ? raw.economy_enabled : false;
  const techTreesEnabled = typeof raw.tech_trees_enabled === 'boolean' ? raw.tech_trees_enabled : false;
  const eventsEnabled = typeof raw.events_enabled === 'boolean' ? raw.events_enabled : false;
  const navalEnabled = typeof raw.naval_enabled === 'boolean' ? raw.naval_enabled : false;
  const stabilityEnabled = typeof raw.stability_enabled === 'boolean' ? raw.stability_enabled : false;
  const territorySelection = typeof raw.territory_selection === 'boolean' ? raw.territory_selection : false;

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
  if (Array.isArray(fromArr) && fromArr.length > 0) {
    allowed = [...new Set(fromArr.filter(isVictoryType))];
    if (allowed.length === 0) allowed = ['domination'];
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

  return {
    fog_of_war: fog,
    victory_type: vt,
    allowed_victory_conditions: allowed,
    victory_threshold: threshold,
    turn_timer_seconds: turnTimer,
    initial_unit_count: initialUnits,
    card_set_escalating: cardEsc,
    diplomacy_enabled: dip,
    tutorial: typeof raw.tutorial === 'boolean' ? raw.tutorial : undefined,
    tutorial_step: typeof raw.tutorial_step === 'number' ? raw.tutorial_step : undefined,
    async_mode: asyncMode || undefined,
    async_turn_deadline_seconds: asyncDeadlineSeconds,
    factions_enabled: factionsEnabled || undefined,
    economy_enabled: economyEnabled || undefined,
    tech_trees_enabled: techTreesEnabled || undefined,
    events_enabled: eventsEnabled || undefined,
    naval_enabled: navalEnabled || undefined,
    stability_enabled: stabilityEnabled || undefined,
    territory_selection: territorySelection || undefined,
  };
}

export function getAllowedVictoryConditions(settings: GameSettings): VictoryType[] {
  if (settings.allowed_victory_conditions && settings.allowed_victory_conditions.length > 0) {
    return settings.allowed_victory_conditions;
  }
  return [settings.victory_type ?? 'domination'];
}

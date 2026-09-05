import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

/** The row shape the settings builder needs: the spec plus the persisted identity. */
export interface DailyChallengeSettingsRow {
  challenge_date: string;
  seed: number;
  player_count: number;
  spec: DailyPuzzleSpec;
}

/** Settings keys an authored spec may never override. */
const PROTECTED_SETTINGS_KEYS = new Set([
  'daily_challenge_date',
  'daily_challenge_spec',
  'seed',
  'max_players',
]);

export function buildGameSettingsFromChallenge(row: DailyChallengeSettingsRow): Record<string, unknown> {
  const spec = row.spec;
  const common: Record<string, unknown> = {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    daily_challenge_date: row.challenge_date,
    daily_challenge_spec: spec,
    seed: row.seed,
    max_players: row.player_count,
  };

  if (spec.archetype === 'domination') {
    return withSpecOverrides(
      {
        ...common,
        allowed_victory_conditions: ['domination'],
        victory_type: 'domination',
      },
      spec,
    );
  }

  const extra: Record<string, unknown> = {
    ...common,
    allowed_victory_conditions: [],
    victory_type: 'domination',
  };

  if (spec.archetype === 'economy_build') {
    extra.economy_enabled = true;
  }
  if (spec.archetype === 'tech_research') {
    extra.tech_trees_enabled = true;
    // Economy too, or the day cannot be played. Tech points accrue only inside
    // applyEconomyIncome, which returns early when economy is off, and the
    // starting-resource bootstrap in initializeGameState requires BOTH flags.
    // With tech alone a player begins on 0 points and earns none for the whole
    // puzzle: an authored day was winnable only because its grant covered the
    // full cost, and a generated tech day — which grants nothing — could never
    // be solved at all.
    extra.economy_enabled = true;
  }
  return withSpecOverrides(extra, spec);
}

/**
 * Authored days may layer extra settings (e.g. naval_enabled) onto the daily
 * defaults. Protected keys are dropped, and everything that survives still
 * passes the normal settings normalizer at game start — an override can only
 * reach keys the normalizer understands.
 */
function withSpecOverrides(
  settings: Record<string, unknown>,
  spec: DailyPuzzleSpec,
): Record<string, unknown> {
  if (!spec.settings_overrides) return settings;
  const merged = { ...settings };
  for (const [key, value] of Object.entries(spec.settings_overrides)) {
    if (PROTECTED_SETTINGS_KEYS.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}


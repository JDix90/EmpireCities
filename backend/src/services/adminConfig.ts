import { query, queryOne } from '../db/postgres';
import type { BuildingType, GameSettings } from '../types';

export type GameType = 'solo' | 'multiplayer' | 'hybrid';

type Bucket = 'blitz_120' | 'standard_300' | 'long_1200' | 'async_43200' | 'async_86400' | 'async_259200';

export interface MatchmakingBucketConfig {
  turn_timer_seconds: number;
  label: string;
  async_mode?: boolean;
}

export interface MatchmakingConfig {
  threshold_base: number;
  threshold_wait_bonus_per_30s: number;
  buckets: Record<Bucket, MatchmakingBucketConfig>;
}

export interface XpConfig {
  base: number;
  win_bonus: number;
  per_territory: number;
  placement_bonus_max: number;
  multipliers: Record<GameType, number>;
}

export interface GlickoConfig {
  initial_mu: number;
  initial_phi: number;
  phi_floor: number;
  phi_ceiling: number;
  mu_floor: number;
  mu_ceiling: number;
}

export interface EconomyConfig {
  building_costs: Record<BuildingType, number>;
  production_income: Partial<Record<BuildingType, number>>;
}

export interface AdminConfigState {
  economy: EconomyConfig;
  xp: XpConfig;
  glicko: GlickoConfig;
  matchmaking: MatchmakingConfig;
  default_game_settings: Pick<GameSettings, 'turn_timer_seconds' | 'initial_unit_count'>;
  feature_flags: Record<string, boolean>;
}

const DEFAULTS: AdminConfigState = {
  economy: {
    building_costs: {
      production_1: 3, production_2: 6, production_3: 10,
      defense_1: 3, defense_2: 6, defense_3: 10,
      tech_gen_1: 4, tech_gen_2: 8,
      special_a: 5, special_b: 8,
      port: 5, naval_base: 10, coastal_battery: 4,
      wonder_colosseum: 18, wonder_cathedral: 20, wonder_lighthouse: 18,
      wonder_manhattan: 25, wonder_sputnik: 20, wonder_cern: 22,
      wonder_arsenal: 18, wonder_unification: 20, wonder_space_elevator: 25,
      wonder_hyperlane_anchor: 22,
      launch_pad: 8,
    },
    production_income: {
      production_1: 1, production_2: 2, production_3: 4,
    },
  },
  xp: {
    base: 50,
    win_bonus: 100,
    per_territory: 2,
    placement_bonus_max: 40,
    multipliers: { solo: 0.5, multiplayer: 1, hybrid: 0.75 },
  },
  glicko: {
    initial_mu: 1500,
    initial_phi: 350,
    phi_floor: 30,
    phi_ceiling: 350,
    mu_floor: 100,
    mu_ceiling: 4000,
  },
  matchmaking: {
    threshold_base: 200,
    threshold_wait_bonus_per_30s: 50,
    buckets: {
      blitz_120: { turn_timer_seconds: 120, label: 'Blitz 2m' },
      standard_300: { turn_timer_seconds: 300, label: 'Standard 5m' },
      long_1200: { turn_timer_seconds: 1200, label: 'Long 20m' },
      async_43200: { turn_timer_seconds: 43200, label: 'Async 12h', async_mode: true },
      async_86400: { turn_timer_seconds: 86400, label: 'Async 24h', async_mode: true },
      async_259200: { turn_timer_seconds: 259200, label: 'Async 3d', async_mode: true },
    },
  },
  default_game_settings: {
    turn_timer_seconds: 300,
    initial_unit_count: 3,
  },
  feature_flags: {
    map_editor_enabled: false,
    era_advancement_lobby_enabled: false,
  },
};

let cache: AdminConfigState = structuredClone(DEFAULTS);

const CONFIG_KEYS: Record<keyof AdminConfigState, string> = {
  economy: 'economy',
  xp: 'xp',
  glicko: 'glicko',
  matchmaking: 'matchmaking',
  default_game_settings: 'default_game_settings',
  feature_flags: 'feature_flags',
};

function mergeFromDb(value: unknown, fallback: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) return value;
  return { ...(fallback as Record<string, unknown>), ...(value as Record<string, unknown>) };
}

export async function refreshAdminConfigCache(): Promise<void> {
  const rows = await query<{ config_key: string; value: unknown }>(
    `SELECT config_key, value FROM admin_config WHERE config_key = ANY($1)`,
    [Object.values(CONFIG_KEYS)],
  );
  const map = new Map(rows.map((r) => [r.config_key, r.value]));
  cache = {
    economy: mergeFromDb(map.get(CONFIG_KEYS.economy), DEFAULTS.economy) as EconomyConfig,
    xp: mergeFromDb(map.get(CONFIG_KEYS.xp), DEFAULTS.xp) as XpConfig,
    glicko: mergeFromDb(map.get(CONFIG_KEYS.glicko), DEFAULTS.glicko) as GlickoConfig,
    matchmaking: mergeFromDb(map.get(CONFIG_KEYS.matchmaking), DEFAULTS.matchmaking) as MatchmakingConfig,
    default_game_settings: mergeFromDb(
      map.get(CONFIG_KEYS.default_game_settings),
      DEFAULTS.default_game_settings,
    ) as AdminConfigState['default_game_settings'],
    feature_flags: mergeFromDb(map.get(CONFIG_KEYS.feature_flags), DEFAULTS.feature_flags) as Record<string, boolean>,
  };
}

export function getAdminConfigSnapshot(): AdminConfigState {
  return structuredClone(cache);
}

export function setAdminConfigCacheForTests(next: Partial<AdminConfigState>): void {
  cache = {
    ...cache,
    ...next,
    economy: { ...cache.economy, ...(next.economy ?? {}) },
    xp: { ...cache.xp, ...(next.xp ?? {}) },
    glicko: { ...cache.glicko, ...(next.glicko ?? {}) },
    matchmaking: { ...cache.matchmaking, ...(next.matchmaking ?? {}) },
    default_game_settings: { ...cache.default_game_settings, ...(next.default_game_settings ?? {}) },
    feature_flags: { ...cache.feature_flags, ...(next.feature_flags ?? {}) },
  };
}

export function resetAdminConfigCacheForTests(): void {
  cache = structuredClone(DEFAULTS);
}

export function getEconomyConfig(): EconomyConfig {
  return cache.economy;
}

export function getXpConfig(): XpConfig {
  return cache.xp;
}

export function getGlickoConfig(): GlickoConfig {
  return cache.glicko;
}

export function getMatchmakingConfig(): MatchmakingConfig {
  return cache.matchmaking;
}

export function getDefaultGameSettingsConfig(): AdminConfigState['default_game_settings'] {
  return cache.default_game_settings;
}

export function getFeatureFlagOverrides(): Record<string, boolean> {
  return cache.feature_flags;
}

export function applyAdminSnapshotsToSettings<T extends Record<string, unknown>>(settings: T): T {
  return {
    ...settings,
    economy_snapshot: {
      building_costs: cache.economy.building_costs,
      production_income: cache.economy.production_income,
    },
    xp_snapshot: cache.xp,
  };
}

export async function upsertAdminConfig(configKey: keyof AdminConfigState, value: unknown, adminUserId: string): Promise<void> {
  await query(
    `INSERT INTO admin_config (config_key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (config_key) DO UPDATE
     SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [CONFIG_KEYS[configKey], JSON.stringify(value), adminUserId],
  );
  await refreshAdminConfigCache();
}

export async function getAdminConfigRow(configKey: keyof AdminConfigState): Promise<unknown | null> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM admin_config WHERE config_key = $1`,
    [CONFIG_KEYS[configKey]],
  );
  return row?.value ?? null;
}

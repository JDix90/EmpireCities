import type { GameState, PlayerState } from '../../types';
import { getEraTechTree } from '../eras';
import { resolvePlayerEraId } from './constants';
import { getStateSpineSteps } from './spines';

/**
 * Tech echo — permanent passive bonuses carried over from eras a player has
 * departed. Stored era-keyed (`{ ancient: { attack_bonus: 2 } }`) so each
 * era's contribution can be weighted by how long ago it was departed.
 *
 * EA-202: decay and per-stat caps are live. Each departed era's contribution
 * is weighted by `era_advancement_echo_decay ^ (eras since departure)` and the
 * era-keyed total is clamped to a per-stat cap, then rounded — combat/income
 * bonuses are discrete. The `legacy` bucket (echoes captured before the store
 * was era-keyed) is exempt from BOTH decay and caps so no in-flight player
 * loses power on deploy.
 */

export type TechEchoStat = 'attack_bonus' | 'defense_bonus' | 'reinforce_bonus' | 'tech_point_income';

const ECHO_STATS: TechEchoStat[] = ['attack_bonus', 'defense_bonus', 'reinforce_bonus', 'tech_point_income'];

/**
 * Era key for echoes captured before the store was era-keyed. The departing
 * era of a flat echo is unknowable, so legacy echoes are decay-exempt: an
 * in-flight player must never lose power on deploy.
 */
export const LEGACY_ECHO_KEY = 'legacy';

const ECHO_CAP_SETTING: Record<TechEchoStat, keyof import('../../types').GameSettings> = {
  attack_bonus: 'era_advancement_echo_cap_attack',
  defense_bonus: 'era_advancement_echo_cap_defense',
  reinforce_bonus: 'era_advancement_echo_cap_reinforce',
  tech_point_income: 'era_advancement_echo_cap_tech',
};

const ECHO_CAP_DEFAULT: Record<TechEchoStat, number> = {
  attack_bonus: 2,
  defense_bonus: 2,
  reinforce_bonus: 2,
  tech_point_income: 3,
};

/** Pre-era-keyed saves store the echo flat: stat name -> number. */
export function isFlatEchoRecord(
  echo: NonNullable<PlayerState['era_advancement_tech_echo']>,
): echo is Record<string, number> {
  return Object.values(echo).some((v) => typeof v === 'number');
}

/**
 * Migrate a player's flat echo into the era-keyed shape under `legacy`.
 * Idempotent — keyed stores pass through untouched. Called from
 * `repairLegacyGameState` on every load, and defensively before writes.
 */
export function ensureEraKeyedEcho(player: PlayerState): Record<string, Record<string, number>> {
  const echo = player.era_advancement_tech_echo;
  if (!echo) {
    const fresh: Record<string, Record<string, number>> = {};
    player.era_advancement_tech_echo = fresh;
    return fresh;
  }
  if (isFlatEchoRecord(echo)) {
    const keyed: Record<string, Record<string, number>> = { [LEGACY_ECHO_KEY]: { ...echo } };
    player.era_advancement_tech_echo = keyed;
    return keyed;
  }
  return echo as Record<string, Record<string, number>>;
}

/** Sum the echo-relevant passive bonuses across a player's unlocked techs in their current era. */
export function captureTechEcho(state: GameState, player: PlayerState): Record<string, number> {
  const departingEra = resolvePlayerEraId(state, player);
  const tree = getEraTechTree(departingEra);
  const unlocked = player.unlocked_techs ?? [];
  const echo: Record<string, number> = {};

  for (const techId of unlocked) {
    const node = tree.find((n) => n.tech_id === techId);
    if (!node) continue;
    for (const stat of ECHO_STATS) {
      const value = node[stat];
      if (value) echo[stat] = (echo[stat] ?? 0) + value;
    }
  }

  return echo;
}

/** Merge a departing era's captured echo into the player's era-keyed store. */
export function storeTechEcho(player: PlayerState, eraId: string, captured: Record<string, number>): void {
  if (Object.keys(captured).length === 0) return;
  const keyed = ensureEraKeyedEcho(player);
  const existing = keyed[eraId] ?? {};
  const merged: Record<string, number> = { ...existing };
  for (const [stat, value] of Object.entries(captured)) {
    merged[stat] = (merged[stat] ?? 0) + value;
  }
  keyed[eraId] = merged;
}

/**
 * Total echo bonus for one stat. Era-keyed contributions decay with spine
 * distance and are clamped to a per-stat cap; the legacy bucket bypasses both
 * (grandfathered at full strength) and is added on top. The final value is
 * rounded — combat/income bonuses are integers. Reads the flat store shape too
 * so hand-built test states work without a repair pass.
 */
export function getTechEchoBonus(state: GameState, player: PlayerState, stat: TechEchoStat): number {
  if (!state.settings.era_advancement_enabled) return 0;
  const echo = player.era_advancement_tech_echo;
  if (!echo) return 0;
  if (isFlatEchoRecord(echo)) return echo[stat] ?? 0;

  const keyed = echo as Record<string, Record<string, number>>;
  const currentIndex = player.current_era_index ?? 0;
  const legacyRaw = keyed[LEGACY_ECHO_KEY]?.[stat] ?? 0;

  let weighted = 0;
  for (const [eraKey, stats] of Object.entries(keyed)) {
    if (eraKey === LEGACY_ECHO_KEY) continue;
    const value = stats?.[stat] ?? 0;
    if (!value) continue;
    weighted += value * echoWeight(state, eraKey, currentIndex);
  }
  const capped = Math.min(weighted, getEchoCap(state, stat));
  return legacyRaw + Math.round(capped);
}

function getEchoCap(state: GameState, stat: TechEchoStat): number {
  const value = state.settings[ECHO_CAP_SETTING[stat]];
  return typeof value === 'number' ? value : ECHO_CAP_DEFAULT[stat];
}

function echoWeight(state: GameState, eraKey: string, currentIndex: number): number {
  const eraIndex = getStateSpineSteps(state).findIndex((s) => s.era_id === eraKey);
  if (eraIndex < 0) return 1;
  const gap = Math.max(0, currentIndex - eraIndex - 1);
  const decay = state.settings.era_advancement_echo_decay ?? 0.5;
  return decay ** gap;
}

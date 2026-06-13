import type { GameState, PlayerState } from '../../types';
import { getEraTechTree } from '../eras';
import { resolvePlayerEraId } from './constants';
import { getStateSpineSteps } from './spines';

/**
 * Tech echo — permanent passive bonuses carried over from eras a player has
 * departed. Stored era-keyed (`{ ancient: { attack_bonus: 2 } }`) so each
 * era's contribution can be weighted by how long ago it was departed.
 *
 * EA-103 scaffolding: the per-era weighting math is in place but neutral
 * (decay 1.0, no caps), so totals match the legacy flat store exactly.
 * EA-202 wires `era_advancement_echo_decay` / cap settings into
 * `echoWeight` and decides rounding when weights go fractional.
 */

export type TechEchoStat = 'attack_bonus' | 'defense_bonus' | 'reinforce_bonus' | 'tech_point_income';

const ECHO_STATS: TechEchoStat[] = ['attack_bonus', 'defense_bonus', 'reinforce_bonus', 'tech_point_income'];

/**
 * Era key for echoes captured before the store was era-keyed. The departing
 * era of a flat echo is unknowable, so legacy echoes are decay-exempt: an
 * in-flight player must never lose power on deploy.
 */
export const LEGACY_ECHO_KEY = 'legacy';

const NEUTRAL_ECHO_DECAY = 1.0;

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
 * Total echo bonus for one stat, weighting each departed era's contribution
 * by spine distance. Reads both store shapes so hand-built test states work
 * without a repair pass.
 */
export function getTechEchoBonus(state: GameState, player: PlayerState, stat: TechEchoStat): number {
  if (!state.settings.era_advancement_enabled) return 0;
  const echo = player.era_advancement_tech_echo;
  if (!echo) return 0;
  if (isFlatEchoRecord(echo)) return echo[stat] ?? 0;

  const keyed = echo as Record<string, Record<string, number>>;
  const currentIndex = player.current_era_index ?? 0;
  let total = 0;
  for (const [eraKey, stats] of Object.entries(keyed)) {
    const value = stats?.[stat] ?? 0;
    if (!value) continue;
    total += value * echoWeight(state, eraKey, currentIndex);
  }
  return total;
}

function echoWeight(state: GameState, eraKey: string, currentIndex: number): number {
  if (eraKey === LEGACY_ECHO_KEY) return 1;
  const eraIndex = getStateSpineSteps(state).findIndex((s) => s.era_id === eraKey);
  if (eraIndex < 0) return 1;
  const gap = Math.max(0, currentIndex - eraIndex - 1);
  return NEUTRAL_ECHO_DECAY ** gap;
}

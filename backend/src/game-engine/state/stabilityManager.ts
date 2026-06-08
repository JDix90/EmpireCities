// ============================================================
// Stability Manager — territory stability & population mechanics
// ============================================================

import { randomInt } from 'crypto';
import type { GameState } from '../../types';
import { getFactionById } from '../eras';

/**
 * CSPRNG-backed [0, 1) replacement for Math.random(). Stability/population
 * outcomes affect game state (rebellions remove units; territories can flip
 * to unowned), so we must not let clients predict the rolls.
 */
function cryptoFraction(): number {
  // randomInt(0, 2**32) yields a uniform 32-bit integer; divide by the upper
  // bound for the standard [0, 1) double.
  return randomInt(0, 0x100000000) / 0x100000000;
}

// ── Constants ──────────────────────────────────────────────────────────

const BASE_STABILITY_RECOVERY = 5;
const GARRISON_THRESHOLD = 5;       // units needed for garrison bonus
const GARRISON_RECOVERY_BONUS = 2;  // extra stability/turn when garrisoned
const INITIAL_STABILITY = 80;
const CAPTURE_STABILITY = 30;
const INFLUENCE_PENALTY = 20;
const REBELLION_THRESHOLD = 10;     // stability ≤ this triggers rebellion check
const REBELLION_CHANCE = 0.25;      // 25% per territory per tick

const INITIAL_POPULATION = 3;
const MAX_POPULATION = 10;
const POPULATION_GROWTH_STABILITY = 50;  // min stability to grow
const POPULATION_GROWTH_INTERVAL = 4;    // grow +1 every N turns of eligibility
const CAPTURE_POPULATION_FLOOR = 1;      // population after capture

// Deploy caps based on stability thresholds (independent of economy)
const DEPLOY_CAP_CRITICAL = 1;      // stability < 30
const DEPLOY_CAP_LOW = 3;           // stability 30-49
// stability ≥ 50 → no cap
const DEPLOY_CAP_ERA_BONUS_MAX = 3;
const DEPLOY_CAP_TURN_BONUS_MAX = 10;
const DEPLOY_CAP_ECONOMY_BONUS_MAX = 2;
const DEPLOY_CAP_TURN_STEP = 7;
const DEPLOY_CAP_TURN_STEP_BONUS = 2;

// ── Initialization ─────────────────────────────────────────────────────

/**
 * Initialize stability and population on all owned territories.
 */
export function initializeStability(state: GameState): void {
  for (const t of Object.values(state.territories)) {
    if (t.owner_id) {
      t.stability = INITIAL_STABILITY;
      t.population = INITIAL_POPULATION;
    }
  }
}

// ── Turn tick ──────────────────────────────────────────────────────────

/**
 * Per-turn stability recovery, rebellion check, and population growth
 * for the active player. Called once per turn in advanceToNextPlayer.
 *
 * Returns a list of territory IDs that rebelled (lost units or went unowned).
 */
export function applyStabilityTick(
  state: GameState,
  playerId: string,
): string[] {
  const rebellions: string[] = [];
  const factionBonus = getFactionStabilityBonus(state, playerId);

  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.owner_id !== playerId || t.stability == null) continue;

    // ── Rebellion check (before recovery) ──
    if (t.stability <= REBELLION_THRESHOLD && t.unit_count > 0) {
      if (cryptoFraction() < REBELLION_CHANCE) {
        t.unit_count -= 1;
        rebellions.push(tid);
        if (t.unit_count <= 0) {
          // Territory goes unowned
          t.owner_id = null;
          t.unit_count = 0;
          t.stability = undefined;
          t.population = undefined;
          // Update territory count
          const player = state.players.find((p) => p.player_id === playerId);
          if (player) {
            player.territory_count = Object.values(state.territories)
              .filter((tt) => tt.owner_id === playerId).length;
          }
          continue; // Skip recovery for lost territory
        }
      }
    }

    // ── Stability recovery ──
    let recovery = BASE_STABILITY_RECOVERY;

    // Garrison bonus: territories with ≥ 5 units recover faster
    if (t.unit_count >= GARRISON_THRESHOLD) {
      recovery += GARRISON_RECOVERY_BONUS;
    }

    // Faction bonus (e.g., Roman stability recovery)
    recovery += factionBonus;

    // Campaign carry: Revolutionary Spirit adds stability recovery for the human player
    const player = state.players.find((p) => p.player_id === playerId);
    if (!player?.is_ai) {
      recovery += state.settings.campaign_carry?.revolutionary_spirit ?? 0;
    }

    t.stability = Math.min(100, t.stability + recovery);

    // ── Population growth ──
    if (t.population == null) t.population = INITIAL_POPULATION;
    if (t.stability >= POPULATION_GROWTH_STABILITY && t.population < MAX_POPULATION) {
      // Population grows +1 every POPULATION_GROWTH_INTERVAL turns of sustained stability.
      // We use a simple probabilistic approach: 1/INTERVAL chance per tick.
      if (cryptoFraction() < 1 / POPULATION_GROWTH_INTERVAL) {
        t.population = Math.min(MAX_POPULATION, t.population + 1);
      }
    }
    // Instability shrinks population slowly
    if (t.stability < 30 && t.population > 1) {
      // 10% chance to lose 1 population per tick when unstable
      if (cryptoFraction() < 0.1) {
        t.population -= 1;
      }
    }
  }

  return rebellions;
}

// ── Capture / Influence penalties ──────────────────────────────────────

/**
 * When a territory is captured via combat, set stability to 30 and reduce population.
 */
export function onCaptureStabilityPenalty(state: GameState, territoryId: string): void {
  const t = state.territories[territoryId];
  if (!t) return;
  t.stability = CAPTURE_STABILITY;
  // Population drops to floor on capture (conquered populace is diminished)
  if (t.population != null) {
    t.population = Math.max(CAPTURE_POPULATION_FLOOR, Math.ceil(t.population / 2));
  } else {
    t.population = CAPTURE_POPULATION_FLOOR;
  }
}

/**
 * When a territory is flipped via Cold War influence, subtract 20 stability (floor 0).
 */
export function onInfluenceStabilityPenalty(state: GameState, territoryId: string): void {
  const t = state.territories[territoryId];
  if (t && t.stability != null) {
    t.stability = Math.max(0, t.stability - INFLUENCE_PENALTY);
  }
}

// ── Deploy cap ─────────────────────────────────────────────────────────

/**
 * Returns the maximum number of units that can be deployed to this territory
 * in a single draft phase. Returns Infinity when there is no cap.
 * Works independently of economy — the cap applies whenever stability is enabled.
 */
export function getDeployCap(
  stability: number | undefined,
  context?: {
    era?: GameState['era'];
    turnNumber?: number;
    economyEnabled?: boolean;
    playerSpecialResource?: number;
  },
): number {
  if (stability == null) return Infinity;
  if (stability >= 50) return Infinity;

  const baseCap = stability < 30 ? DEPLOY_CAP_CRITICAL : DEPLOY_CAP_LOW;
  const eraBonus = getEraDeployCapBonus(context?.era);
  const turnBonus = Math.min(
    DEPLOY_CAP_TURN_BONUS_MAX,
    Math.max(
      0,
      Math.floor(((context?.turnNumber ?? 1) - 1) / DEPLOY_CAP_TURN_STEP) * DEPLOY_CAP_TURN_STEP_BONUS,
    ),
  );
  const economyBonus = getEconomyDeployCapBonus(
    !!context?.economyEnabled,
    context?.playerSpecialResource ?? 0,
  );
  return baseCap + eraBonus + turnBonus + economyBonus;
}

function getEraDeployCapBonus(era: GameState['era'] | undefined): number {
  switch (era) {
    case 'ww2':
    case 'acw':
    case 'risorgimento':
      return 1;
    case 'coldwar':
    case 'modern':
      return 2;
    case 'space_age':
      return 3;
    case 'galaxy_age':
      return 4;
    default:
      return 0;
  }
}

function getEconomyDeployCapBonus(
  economyEnabled: boolean,
  playerSpecialResource: number,
): number {
  if (!economyEnabled) return 0;
  if (playerSpecialResource >= 25) return DEPLOY_CAP_ECONOMY_BONUS_MAX;
  if (playerSpecialResource >= 10) return 1;
  return 0;
}

// ── Production multiplier ──────────────────────────────────────────────

/**
 * Returns a multiplier 0.0–1.0 based on the territory stability.
 * Used by economy to scale production.
 */
export function getStabilityMultiplier(stability: number | undefined): number {
  if (stability == null) return 1;
  return stability / 100;
}

/**
 * Returns a population-based production multiplier.
 * population 1 = 0.5x, population 5 = 1.0x, population 10 = 1.5x.
 * Linearly interpolated: (population - 1) / (10 - 1) * 1.0 + 0.5
 */
export function getPopulationMultiplier(population: number | undefined): number {
  if (population == null) return 1;
  const clamped = Math.max(1, Math.min(MAX_POPULATION, population));
  return 0.5 + ((clamped - 1) / (MAX_POPULATION - 1));
}

// ── Event card: stability_change ───────────────────────────────────────

/**
 * Apply a flat stability change to all territories owned by the given player.
 * Positive values = gain, negative = loss. Clamped to [0, 100].
 */
export function applyStabilityChange(
  state: GameState,
  playerId: string,
  delta: number,
): void {
  for (const t of Object.values(state.territories)) {
    if (t.owner_id !== playerId || t.stability == null) continue;
    t.stability = Math.max(0, Math.min(100, t.stability + delta));
  }
}

/**
 * Apply a flat stability change to ALL owned territories (global event).
 */
export function applyGlobalStabilityChange(state: GameState, delta: number): void {
  for (const t of Object.values(state.territories)) {
    if (t.owner_id == null || t.stability == null) continue;
    t.stability = Math.max(0, Math.min(100, t.stability + delta));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function getFactionStabilityBonus(state: GameState, playerId: string): number {
  if (!state.settings.factions_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player?.faction_id) return 0;
  const faction = getFactionById(state.era, player.faction_id);
  return faction?.stability_recovery_bonus ?? 0;
}

// ── Exported constants (for tests and UI) ──────────────────────────────

export const STABILITY_CONSTANTS = {
  BASE_STABILITY_RECOVERY,
  GARRISON_THRESHOLD,
  GARRISON_RECOVERY_BONUS,
  INITIAL_STABILITY,
  CAPTURE_STABILITY,
  INFLUENCE_PENALTY,
  REBELLION_THRESHOLD,
  REBELLION_CHANCE,
  INITIAL_POPULATION,
  MAX_POPULATION,
  POPULATION_GROWTH_STABILITY,
  POPULATION_GROWTH_INTERVAL,
  CAPTURE_POPULATION_FLOOR,
  DEPLOY_CAP_CRITICAL,
  DEPLOY_CAP_LOW,
  DEPLOY_CAP_ERA_BONUS_MAX,
  DEPLOY_CAP_TURN_BONUS_MAX,
  DEPLOY_CAP_ECONOMY_BONUS_MAX,
  DEPLOY_CAP_TURN_STEP,
  DEPLOY_CAP_TURN_STEP_BONUS,
} as const;

/**
 * Population-weighted average stability across all territories owned by a player.
 * Returns 100 when the player owns no stability-tracked territories.
 */
export function getEmpireWeightedStability(state: GameState, playerId: string): number {
  let weightedSum = 0;
  let popSum = 0;

  for (const territory of Object.values(state.territories)) {
    if (territory.owner_id !== playerId || territory.stability == null) continue;
    const pop = Math.max(1, territory.population ?? 1);
    weightedSum += territory.stability * pop;
    popSum += pop;
  }

  if (popSum <= 0) return 100;
  return weightedSum / popSum;
}

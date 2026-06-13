import { randomInt } from 'crypto';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { canAdvanceEra } from '../eraAdvancement/advanceEra';
import { getPlayerEraIndex } from '../eraAdvancement/constants';
import { ERA_SIGNATURES } from '../eraAdvancement/signatures';
import { getMaxEraIndex, getStateSpineSteps } from '../eraAdvancement/spines';
import { getEmpireWeightedStability } from '../state/stabilityManager';

/** Minimum advance_score to trigger era climb by difficulty. */
const ADVANCE_THRESHOLDS: Record<AiDifficulty, number> = {
  tutorial: Number.POSITIVE_INFINITY,
  easy: 12,
  medium: 6,
  hard: 4,
  expert: 3,
};

/**
 * Threat is measured RELATIVE to the player's own border defense, not as an
 * absolute unit count — in a developed game every border bristles with units, so
 * an absolute cap would permanently block advancement (a lesson from the EA-502
 * balance sim). The hard block triggers only when meaningfully outgunned.
 */
const HEAVY_THREAT_RATIO = 1.5;
/** ...and only once the enemy border force is non-trivial in absolute terms. */
const MIN_BLOCK_THREAT = 6;
/** Pacing prior: target the first advance around this turn, then every PACE turns. */
const FIRST_ADVANCE_TURN = 4;
const ADVANCE_PACE = 5;

function buildAdjacency(map: GameMap): Record<string, string[]> {
  const adjacency: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (conn.type === 'sea') continue;
    if (!adjacency[conn.from]) adjacency[conn.from] = [];
    if (!adjacency[conn.to]) adjacency[conn.to] = [];
    adjacency[conn.from].push(conn.to);
    adjacency[conn.to].push(conn.from);
  }
  return adjacency;
}

/** Sum of enemy unit counts on land-adjacent border territories. */
export function countBorderThreat(state: GameState, map: GameMap, playerId: string): number {
  const adjacency = buildAdjacency(map);
  let threat = 0;
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId) continue;
    for (const nid of adjacency[tid] ?? []) {
      const neighbor = state.territories[nid];
      if (!neighbor?.owner_id || neighbor.owner_id === playerId) continue;
      threat += neighbor.unit_count;
    }
  }
  return threat;
}

/** Sum of the player's OWN units on territories that border an enemy (defensive strength). */
export function countBorderStrength(state: GameState, map: GameMap, playerId: string): number {
  const adjacency = buildAdjacency(map);
  let strength = 0;
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId) continue;
    const bordersEnemy = (adjacency[tid] ?? []).some((nid) => {
      const n = state.territories[nid];
      return n?.owner_id && n.owner_id !== playerId;
    });
    if (bordersEnemy) strength += tState.unit_count;
  }
  return strength;
}

export function maxOpponentEraIndex(state: GameState, playerId: string): number {
  let max = 0;
  for (const p of state.players) {
    if (p.player_id === playerId || p.is_eliminated) continue;
    max = Math.max(max, getPlayerEraIndex(state, p.player_id));
  }
  return max;
}

export interface AiEraAdvancementScore {
  shouldAdvance: boolean;
  score: number;
  threshold: number;
  gatePassed: boolean;
}

/**
 * Score-based advance/stay heuristic for era-advancement matches.
 * Evaluated at the start of the AI draft phase.
 */
export function evaluateAiEraAdvancement(
  state: GameState,
  map: GameMap,
  playerId: string,
  difficulty: AiDifficulty,
): AiEraAdvancementScore {
  const threshold = ADVANCE_THRESHOLDS[difficulty];
  if (!state.settings.era_advancement_enabled || difficulty === 'tutorial') {
    return { shouldAdvance: false, score: 0, threshold, gatePassed: false };
  }

  const gate = canAdvanceEra(state, playerId);
  if (!gate.canAdvance) {
    return { shouldAdvance: false, score: 0, threshold, gatePassed: false };
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) {
    return { shouldAdvance: false, score: 0, threshold, gatePassed: false };
  }

  if (state.turn_number < 4 && difficulty !== 'expert') {
    return { shouldAdvance: false, score: 0, threshold, gatePassed: true };
  }

  const myEra = getPlayerEraIndex(state, playerId);
  const maxOppEra = maxOpponentEraIndex(state, playerId);
  const gap = maxOppEra - myEra;
  const maxIndex = getMaxEraIndex(state);
  const cost = gate.cost ?? 0;
  const goldAfter = (player.special_resource ?? 0) - cost;
  const income = Math.max(1, player.last_turn_production_income ?? 0);
  const goldBuffer = goldAfter / income;
  const borderThreat = countBorderThreat(state, map, playerId);
  const borderStrength = countBorderStrength(state, map, playerId);
  const threatRatio = borderThreat / Math.max(1, borderStrength);

  // Hard safety: advancing opens a one-turn vulnerability window. Never do it
  // while meaningfully outgunned on the border — but measured RELATIVE to your
  // own defense, so a strong empire isn't frozen out by big-army stalemates.
  if (borderThreat >= MIN_BLOCK_THREAT && threatRatio >= HEAVY_THREAT_RATIO) {
    return { shouldAdvance: false, score: 0, threshold, gatePassed: true };
  }

  let score = 0;

  // Catch-up: trailing the era leader is urgent, and the trailing-player cost
  // discount makes the climb cheaper the further behind you are.
  if (gap >= 1) score += 4;
  if (gap >= 2) score += 4;

  // Keep a gold cushion after paying the cost.
  if (goldBuffer >= 1) score += 3;
  if (goldBuffer >= 2) score += 2;

  // Border parity/superiority favors taking the vulnerability window now.
  if (threatRatio < 0.5) score += 3;
  if (threatRatio < 0.25) score += 2;

  // Pacing prior — generalizes across the spine: advance roughly on schedule for
  // the current step rather than only racing the first transition.
  const targetTurn = FIRST_ADVANCE_TURN + myEra * ADVANCE_PACE;
  if (state.turn_number >= targetTurn) score += 2;
  if (state.turn_number >= targetTurn + ADVANCE_PACE) score += 2;

  // Signature awareness: an offensive arrival payoff is worth more with targets.
  const nextSignatureId = getStateSpineSteps(state)[myEra + 1]?.signature_id;
  if (nextSignatureId && ERA_SIGNATURES[nextSignatureId]?.attack_die_bonus && borderThreat >= 2) {
    score += 1;
  }

  // End-spine restraint: the final advance resets tech for the apex aura — don't
  // rush it (and lose the research) unless you are behind and need the parity.
  if (myEra + 1 >= maxIndex && gap <= 0) score -= 2;

  if (state.settings.stability_enabled) {
    const stabilityGate = state.settings.era_advancement_stability_gate ?? 60;
    const stability = getEmpireWeightedStability(state, playerId);
    if (stability < stabilityGate + 10) score -= 3;
  }

  // Approaching parity-against-you still discourages advancing (graduated up to
  // the hard block at HEAVY_THREAT_RATIO).
  if (threatRatio >= 1.25) score -= 5;
  else if (threatRatio >= 1.0) score -= 3;

  if (difficulty === 'easy') {
    const roll = randomInt(0, 100);
    if (roll > 15) {
      return { shouldAdvance: false, score, threshold, gatePassed: true };
    }
  }

  return {
    shouldAdvance: score >= threshold,
    score,
    threshold,
    gatePassed: true,
  };
}

/** Attack score bonus when the defender is in the vulnerability window. */
export function vulnerabilityAttackBonus(
  state: GameState,
  defenderId: string | null | undefined,
  difficulty: AiDifficulty,
): number {
  if (!state.settings.era_advancement_enabled || !defenderId) return 0;
  const defender = state.players.find((p) => p.player_id === defenderId);
  if (!defender || (defender.era_transition_turns_remaining ?? 0) <= 0) return 0;
  if (difficulty === 'easy') return 1;
  if (difficulty === 'medium') return 2;
  return 4;
}

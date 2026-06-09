import { randomInt } from 'crypto';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { canAdvanceEra } from '../eraAdvancement/advanceEra';
import { getPlayerEraIndex } from '../eraAdvancement/constants';
import { getEmpireWeightedStability } from '../state/stabilityManager';

/** Minimum advance_score to trigger era climb by difficulty. */
const ADVANCE_THRESHOLDS: Record<AiDifficulty, number> = {
  tutorial: Number.POSITIVE_INFINITY,
  easy: 12,
  medium: 6,
  hard: 4,
  expert: 3,
};

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
  const cost = gate.cost ?? 0;
  const goldAfter = (player.special_resource ?? 0) - cost;
  const income = Math.max(1, player.last_turn_production_income ?? 0);
  const goldBuffer = goldAfter / income;
  const borderThreat = countBorderThreat(state, map, playerId);

  let score = 0;
  if (maxOppEra > myEra) score += 4;
  if (goldBuffer >= 1) score += 3;
  if (goldBuffer >= 2) score += 2;
  if (borderThreat < 5) score += 3;
  if (borderThreat < 2) score += 2;
  if (myEra === 0 && state.turn_number >= 6) score += 2;

  if (state.settings.stability_enabled) {
    const stabilityGate = state.settings.era_advancement_stability_gate ?? 60;
    const stability = getEmpireWeightedStability(state, playerId);
    if (stability < stabilityGate + 10) score -= 3;
  }

  if (borderThreat >= 10) score -= 5;
  if (borderThreat >= 15) score -= 3;

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

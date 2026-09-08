// ============================================================
// AI tech-point budgeting — can the bot afford this ability AND its research?
// ============================================================

import type { AiDifficulty, GameState } from '../../types';
import { getEraTechTree } from '../eras';
import { resolvePlayerEraId } from '../eraAdvancement/constants';
import { getEffectiveTechCost } from '../state/techManager';

/**
 * True when a bot of this difficulty researches at all in this game. Mirrors —
 * and is consumed by — the early returns in `selectAiTechResearch`, so the
 * budget rule below and the research it protects can never disagree about
 * whether research is even on the table.
 */
export function aiResearchesTech(state: GameState, difficulty: AiDifficulty): boolean {
  if (difficulty === 'tutorial') return false;
  if (!state.settings.tech_trees_enabled) return false;
  // Easy stays passive in normal games but must research in era-advancement
  // games (milestone gate) and in the Galactic Age (hyperspace lanes).
  if (difficulty === 'easy' && !state.settings.era_advancement_enabled && state.era !== 'galaxy_age') {
    return false;
  }
  return true;
}

/**
 * Tech points the bot should keep in hand for its next research: the cheapest
 * node it could still buy (prerequisites met, not yet unlocked), at effective
 * cost. Null when it has nothing left to research, or does not research at all.
 *
 * The cheapest researchable node — rather than the specific node
 * `selectAiTechResearch` would name — is the right reserve because every
 * difficulty buys from what it can afford *now*: medium takes the cheapest
 * affordable node, hard and expert the best-scoring affordable one, and the
 * Space Age and Galactic priority hooks walk down a prerequisite chain to the
 * deepest AFFORDABLE rung. None of them save deliberately, so the cheapest
 * researchable node is exactly what the bot needs to still be able to buy
 * something on its next turn.
 */
export function nextResearchReserve(
  state: GameState,
  playerId: string,
  difficulty: AiDifficulty,
): number | null {
  if (!aiResearchesTech(state, difficulty)) return null;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const tree = getEraTechTree(resolvePlayerEraId(state, player));
  const unlocked = player.unlocked_techs ?? [];
  let cheapest: number | null = null;
  for (const node of tree) {
    if (unlocked.includes(node.tech_id)) continue;
    if (node.prerequisite && !unlocked.includes(node.prerequisite)) continue;
    const cost = getEffectiveTechCost(state, player, node);
    if (cheapest == null || cost < cheapest) cheapest = cost;
  }
  return cheapest;
}

/**
 * Whether the AI should fire a draft-phase faction ability that costs tech
 * points right now.
 *
 * Free abilities stay eager: they only ever help. Tech-costed ones do not —
 * a bot that spends 4-6 TP on 2-3 units every turn never accumulates enough to
 * research (Space Age tier 1 costs 4-6, tier 2 costs 9-12), so it trades its
 * whole tech tree, and with it the attack dice, buildings and Moon ladder, for
 * a trickle of infantry. Measured over 120 six-player games: Sino-Pacific won
 * 4.2% firing AI Surge every turn against 21.7% with the ability silenced;
 * Corporate Enclave was unharmed only because its +4 TP/turn income covers the
 * bill. So spend only the surplus above the next research, and spend freely
 * once the tree is exhausted.
 */
export function shouldSpendTechPointsOnAbility(
  state: GameState,
  playerId: string,
  difficulty: AiDifficulty,
  techCost: number,
): boolean {
  if (techCost <= 0) return true;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return false;
  const techPoints = player.tech_points ?? 0;
  if (techPoints < techCost) return false;
  const reserve = nextResearchReserve(state, playerId, difficulty);
  if (reserve == null) return true;
  return techPoints - techCost >= reserve;
}

import type { GameState, GameMap, AiDifficulty } from '../../types';
import { resolveCombat, calculateReinforcements } from '../combat/combatResolver';
import { calculateContinentBonuses, syncTerritoryCounts } from '../state/gameStateManager';

interface AiAction {
  type: 'draft' | 'attack' | 'fortify' | 'end_phase';
  from?: string;
  to?: string;
  units?: number;
  cardIds?: string[];
}

const DIFFICULTY_CONFIG: Record<AiDifficulty, { depth: number; randomFactor: number }> = {
  easy:   { depth: 1, randomFactor: 0.35 },
  medium: { depth: 2, randomFactor: 0.15 },
  hard:   { depth: 3, randomFactor: 0.05 },
  expert: { depth: 4, randomFactor: 0.0  },
};

/**
 * Compute the AI's complete turn actions for the current player.
 * Returns an ordered list of actions to execute.
 */
export function computeAiTurn(
  state: GameState,
  map: GameMap,
  difficulty: AiDifficulty
): AiAction[] {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const actions: AiAction[] = [];
  const playerId = state.players[state.current_player_index].player_id;

  // ── Draft Phase ──────────────────────────────────────────────────────────
  const continentBonus = calculateContinentBonuses(state, map, playerId);
  const player = state.players[state.current_player_index];
  const reinforcements = calculateReinforcements(player.territory_count, continentBonus);

  // Find the best territory to reinforce (highest threat border)
  const draftTarget = selectDraftTarget(state, map, playerId, cfg.randomFactor);
  if (draftTarget) {
    actions.push({ type: 'draft', to: draftTarget, units: reinforcements });
  }

  // ── Attack Phase ─────────────────────────────────────────────────────────
  const attackActions = selectAttacks(state, map, playerId, cfg.randomFactor, difficulty);
  actions.push(...attackActions);
  actions.push({ type: 'end_phase' });

  // ── Fortify Phase ────────────────────────────────────────────────────────
  const fortifyAction = selectFortify(state, map, playerId);
  if (fortifyAction) actions.push(fortifyAction);
  actions.push({ type: 'end_phase' });

  return actions;
}

/**
 * Evaluate a board state from a given player's perspective.
 * Returns a heuristic score — higher is better for the player.
 */
export function evaluateBoard(
  state: GameState,
  map: GameMap,
  playerId: string
): number {
  const totalTerritories = Object.keys(state.territories).length;
  const totalUnits = Object.values(state.territories).reduce((s, t) => s + t.unit_count, 0);

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || player.is_eliminated) return -Infinity;

  // T: Territory ratio
  const T = player.territory_count / totalTerritories;

  // U: Unit ratio
  const myUnits = Object.values(state.territories)
    .filter((t) => t.owner_id === playerId)
    .reduce((s, t) => s + t.unit_count, 0);
  const U = totalUnits > 0 ? myUnits / totalUnits : 0;

  // BSR: Border Security Ratio
  const adjacency = buildAdjacencyMap(map);
  let bsrSum = 0;
  let borderCount = 0;
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId) continue;
    const neighbors = adjacency[tid] || [];
    const enemyNeighbors = neighbors.filter(
      (nid) => state.territories[nid]?.owner_id !== playerId
    );
    if (enemyNeighbors.length === 0) continue;
    const enemyUnits = enemyNeighbors.reduce(
      (s, nid) => s + (state.territories[nid]?.unit_count ?? 0), 0
    );
    bsrSum += enemyUnits > 0 ? tState.unit_count / enemyUnits : 2;
    borderCount++;
  }
  const BSR = borderCount > 0 ? bsrSum / borderCount : 1;

  // C: Continent bonus ratio
  const continentBonus = calculateContinentBonuses(state, map, playerId);
  const maxPossibleBonus = map.regions.reduce((s, r) => s + r.bonus, 0);
  const C = maxPossibleBonus > 0 ? continentBonus / maxPossibleBonus : 0;

  // Weighted sum (weights tuned for balanced play)
  return 0.35 * T + 0.25 * U + 0.25 * BSR + 0.15 * C;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function selectDraftTarget(
  state: GameState,
  map: GameMap,
  playerId: string,
  randomFactor: number
): string | null {
  const adjacency = buildAdjacencyMap(map);
  let bestTid: string | null = null;
  let bestScore = -Infinity;

  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId) continue;
    const neighbors = adjacency[tid] || [];
    const enemyNeighbors = neighbors.filter(
      (nid) => state.territories[nid]?.owner_id !== playerId
    );
    if (enemyNeighbors.length === 0) continue;

    const threatScore = enemyNeighbors.reduce(
      (s, nid) => s + (state.territories[nid]?.unit_count ?? 0), 0
    );
    const score = threatScore - tState.unit_count + Math.random() * randomFactor * 10;
    if (score > bestScore) {
      bestScore = score;
      bestTid = tid;
    }
  }
  return bestTid;
}

function selectAttacks(
  state: GameState,
  map: GameMap,
  playerId: string,
  randomFactor: number,
  difficulty: AiDifficulty
): AiAction[] {
  const adjacency = buildAdjacencyMap(map);
  const actions: AiAction[] = [];
  const maxAttacks = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 4 : 8;

  // Build list of viable attacks sorted by favorability
  const candidates: { from: string; to: string; score: number }[] = [];

  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId || tState.unit_count < 2) continue;
    const neighbors = adjacency[tid] || [];
    for (const nid of neighbors) {
      const nState = state.territories[nid];
      if (!nState || nState.owner_id === playerId) continue;

      // Check truce
      const nOwner = nState.owner_id;
      if (nOwner && isTruceActive(state, playerId, nOwner)) continue;

      const attackUnits = tState.unit_count - 1;
      const attackDice = Math.min(attackUnits, 3);
      const defDice = Math.min(nState.unit_count, 2);

      // Simple favorability: attacker dice advantage
      const score = (attackDice - defDice) + Math.random() * randomFactor * 3;
      if (score > 0 || difficulty === 'easy') {
        candidates.push({ from: tid, to: nid, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  for (let i = 0; i < Math.min(maxAttacks, candidates.length); i++) {
    const { from, to } = candidates[i];
    const fromState = state.territories[from];
    if (!fromState || fromState.unit_count < 2) continue;
    const attackUnits = Math.min(fromState.unit_count - 1, 3);
    actions.push({ type: 'attack', from, to, units: attackUnits });
  }

  return actions;
}

function selectFortify(
  state: GameState,
  map: GameMap,
  playerId: string
): AiAction | null {
  const adjacency = buildAdjacencyMap(map);

  // Find interior territory with most units to move to a border territory
  let bestFrom: string | null = null;
  let bestTo: string | null = null;
  let bestUnits = 0;

  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId || tState.unit_count <= 1) continue;
    const neighbors = adjacency[tid] || [];
    const isInterior = neighbors.every(
      (nid) => state.territories[nid]?.owner_id === playerId
    );
    if (!isInterior) continue;

    // Find adjacent border territory via BFS
    const borderTarget = findNearestBorder(tid, state, map, playerId);
    if (borderTarget && tState.unit_count - 1 > bestUnits) {
      bestFrom = tid;
      bestTo = borderTarget;
      bestUnits = tState.unit_count - 1;
    }
  }

  if (bestFrom && bestTo && bestUnits > 0) {
    return { type: 'fortify', from: bestFrom, to: bestTo, units: bestUnits };
  }
  return null;
}

function findNearestBorder(
  startId: string,
  state: GameState,
  map: GameMap,
  playerId: string
): string | null {
  const adjacency = buildAdjacencyMap(map);
  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency[current] || [];
    for (const nid of neighbors) {
      if (visited.has(nid)) continue;
      if (state.territories[nid]?.owner_id !== playerId) {
        // current is a border territory
        return current;
      }
      visited.add(nid);
      queue.push(nid);
    }
  }
  return null;
}

function isTruceActive(state: GameState, playerIdA: string, playerIdB: string): boolean {
  const playerA = state.players.find((p) => p.player_id === playerIdA);
  const playerB = state.players.find((p) => p.player_id === playerIdB);
  if (!playerA || !playerB) return false;

  const entry = state.diplomacy.find(
    (d) =>
      (d.player_index_a === playerA.player_index && d.player_index_b === playerB.player_index) ||
      (d.player_index_a === playerB.player_index && d.player_index_b === playerA.player_index)
  );
  return entry?.status === 'truce' && entry.truce_turns_remaining > 0;
}

// Cache adjacency maps to avoid recomputation
const adjacencyCache = new Map<string, Record<string, string[]>>();

function buildAdjacencyMap(map: GameMap): Record<string, string[]> {
  if (adjacencyCache.has(map.map_id)) {
    return adjacencyCache.get(map.map_id)!;
  }
  const adj: Record<string, string[]> = {};
  for (const t of map.territories) {
    adj[t.territory_id] = [];
  }
  for (const conn of map.connections) {
    adj[conn.from]?.push(conn.to);
    adj[conn.to]?.push(conn.from);
  }
  adjacencyCache.set(map.map_id, adj);
  return adj;
}

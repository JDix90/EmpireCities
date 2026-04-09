import type { GameState, GameMap, AiDifficulty, BuildingType } from '../../types';
import { calculateReinforcements } from '../combat/combatResolver';
import { calculateContinentBonuses } from '../state/gameStateManager';
import { getAllowedVictoryConditions } from '../state/gameSettings';
import { getFactionById, getEraTechTree } from '../eras';
import { validateBuild } from '../state/economyManager';

export interface AiAction {
  type: 'draft' | 'attack' | 'fortify' | 'end_phase';
  from?: string;
  to?: string;
  units?: number;
  cardIds?: string[];
}

const DIFFICULTY_CONFIG: Record<AiDifficulty, { depth: number; randomFactor: number }> = {
  easy:     { depth: 1, randomFactor: 0.35 },
  medium:   { depth: 2, randomFactor: 0.15 },
  hard:     { depth: 3, randomFactor: 0.05 },
  expert:   { depth: 4, randomFactor: 0.0  },
  tutorial: { depth: 1, randomFactor: 0.9  },
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
  // Tutorial AI: draft to random territory, never attack, skip fortify
  if (difficulty === 'tutorial') {
    const pid = state.players[state.current_player_index].player_id;
    const owned = Object.entries(state.territories)
      .filter(([, t]) => t.owner_id === pid)
      .map(([id]) => id);
    const continentBonus = calculateContinentBonuses(state, map, pid);
    const player = state.players[state.current_player_index];
    const reinforcements = calculateReinforcements(
      player.territory_count,
      continentBonus,
      state.players.length,
    );
    const target = owned[Math.floor(Math.random() * owned.length)] ?? owned[0];
    return [
      ...(target ? [{ type: 'draft' as const, to: target, units: reinforcements }] : []),
      { type: 'end_phase' as const },
      { type: 'end_phase' as const },
      { type: 'end_phase' as const },
    ];
  }

  const cfg = DIFFICULTY_CONFIG[difficulty];
  const actions: AiAction[] = [];
  const playerId = state.players[state.current_player_index].player_id;
  const player = state.players[state.current_player_index];

  // ── Draft Phase ──────────────────────────────────────────────────────────
  const continentBonus = calculateContinentBonuses(state, map, playerId);
  const reinforcements = calculateReinforcements(
    player.territory_count,
    continentBonus,
    state.players.length,
  );

  const draftTarget = selectDraftTarget(state, map, playerId, cfg.randomFactor);
  if (draftTarget) {
    actions.push({ type: 'draft', to: draftTarget, units: reinforcements });
  }
  actions.push({ type: 'end_phase' }); // draft → attack

  // ── Attack Phase ─────────────────────────────────────────────────────────
  const attackActions = selectAttacks(state, map, playerId, cfg.randomFactor, difficulty);
  actions.push(...attackActions);

  // Use influence ability if era supports it (medium+ difficulty)
  if (
    difficulty !== 'easy' &&
    (state.era_modifiers?.influence_spread || state.era_modifiers?.carbonari_network) &&
    !state.influence_used_this_turn
  ) {
    const influenceTarget = selectInfluenceTarget(state, map, playerId);
    if (influenceTarget) {
      actions.push({ type: 'end_phase' }); // marks influence via a custom action type
      // Note: actual influence is sent as a separate event from the AI runner
      // We use a synthetic action type that runAiWithTimeout understands
      actions.push({ type: 'attack', from: '__influence__', to: influenceTarget, units: 0 });
    }
  }

  actions.push({ type: 'end_phase' }); // attack → fortify

  // ── Fortify Phase ────────────────────────────────────────────────────────
  const fortifyAction = selectFortify(state, map, playerId);
  if (fortifyAction) actions.push(fortifyAction);
  actions.push({ type: 'end_phase' }); // fortify → next player

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

/** Extra attack score toward enemy capitals and secret-mission targets. */
function attackObjectiveBonus(state: GameState, attackerId: string, targetTerritoryId: string): number {
  let b = 0;
  const allowed = getAllowedVictoryConditions(state.settings);
  const me = state.players.find((p) => p.player_id === attackerId);
  if (!me) return 0;

  if (allowed.includes('capital')) {
    for (const o of state.players) {
      if (o.player_id === attackerId || o.is_eliminated) continue;
      if (o.capital_territory_id === targetTerritoryId) b += 3;
    }
  }

  if (allowed.includes('secret_mission') && me.secret_mission) {
    const m = me.secret_mission;
    if (m.kind === 'capture_territories') {
      if (m.territory_ids[0] === targetTerritoryId || m.territory_ids[1] === targetTerritoryId) {
        b += 2.5;
      }
    }
    if (m.kind === 'eliminate_player') {
      const owner = state.territories[targetTerritoryId]?.owner_id;
      if (owner === m.target_player_id) b += 2;
    }
  }

  return b;
}

function selectDraftTarget(
  state: GameState,
  map: GameMap,
  playerId: string,
  randomFactor: number
): string | null {
  const adjacency = buildAdjacencyMap(map);
  let bestTid: string | null = null;
  let bestScore = -Infinity;

  // Faction home regions get extra weight
  const player = state.players.find((p) => p.player_id === playerId);
  const factionHomeRegions: string[] = [];
  if (state.settings.factions_enabled && player?.faction_id) {
    const faction = getFactionById(state.era, player.faction_id);
    if (faction) factionHomeRegions.push(...faction.home_region_ids);
  }

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

    // Bonus for faction home region border territories
    const mapTerritory = map.territories.find((t) => t.territory_id === tid);
    const homeBonus = mapTerritory && factionHomeRegions.includes(mapTerritory.region_id) ? 3 : 0;

    const score = threatScore - tState.unit_count + homeBonus + Math.random() * randomFactor * 10;
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

      // Determine effective attack dice (era-aware)
      const conn = map.connections.find(
        (c) => (c.from === tid && c.to === nid) || (c.from === nid && c.to === tid)
      );
      const isSeaLane = state.era_modifiers?.sea_lanes && conn?.type === 'sea';
      const isPrecision = state.era_modifiers?.precision_strike && tState.unit_count >= 4;
      const attackDice = isPrecision ? 3 : isSeaLane ? Math.min(attackUnits, 2) : Math.min(attackUnits, 3);
      const defDice = Math.min(nState.unit_count, 2);

      // Simple favorability: attacker dice advantage
      // Sea-lane attacks get a slight penalty for the reduced dice
      const seaPenalty = isSeaLane ? -0.5 : 0;
      const objectiveBonus = attackObjectiveBonus(state, playerId, nid);
      const score = (attackDice - defDice) + seaPenalty + objectiveBonus + Math.random() * randomFactor * 3;
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

/**
 * Select best influence target for Cold War / Risorgimento era.
 * Tries to pick a low-unit adjacent or near-adjacent enemy territory.
 */
function selectInfluenceTarget(
  state: GameState,
  map: GameMap,
  playerId: string
): string | null {
  const hopLimit = state.era_modifiers?.influence_range ?? 1;
  const adjacency: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adjacency[conn.from]) adjacency[conn.from] = [];
    if (!adjacency[conn.to]) adjacency[conn.to] = [];
    adjacency[conn.from].push(conn.to);
    adjacency[conn.to].push(conn.from);
  }

  const ownedSet = new Set(
    Object.entries(state.territories)
      .filter(([, t]) => t.owner_id === playerId)
      .map(([id]) => id)
  );

  // BFS to collect reachable territories within hopLimit
  const reachable = new Set<string>();
  const visited = new Set<string>(ownedSet);
  let frontier = [...ownedSet];
  for (let hop = 0; hop < hopLimit; hop++) {
    const next: string[] = [];
    for (const tid of frontier) {
      for (const nid of (adjacency[tid] ?? [])) {
        if (!visited.has(nid)) {
          visited.add(nid);
          next.push(nid);
          if (state.territories[nid]?.owner_id !== playerId) {
            reachable.add(nid);
          }
        }
      }
    }
    frontier = next;
  }

  // Prefer neutral territories, then low-garrison enemy territories
  let best: string | null = null;
  let bestScore = Infinity;
  for (const tid of reachable) {
    const t = state.territories[tid];
    if (!t) continue;
    const score = (t.owner_id === null ? -10 : 0) + t.unit_count;
    if (score < bestScore) {
      bestScore = score;
      best = tid;
    }
  }

  // Verify we have enough spare units (≥4 total — need 3 to spend + 1 in reserve)
  const totalUnits = Object.values(state.territories)
    .filter((t) => t.owner_id === playerId)
    .reduce((sum, t) => sum + t.unit_count, 0);

  return totalUnits >= 4 ? best : null;
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

// Eras that favour offensive tech paths.
const AGGRESSIVE_ERAS = new Set(['ww2', 'ancient', 'acw', 'modern']);

/**
 * Choose a building to construct this AI turn, or null to skip.
 * Easy/tutorial difficulty never builds.
 * Hard/expert prioritises defense on the most-threatened border territory;
 * medium uses a simple greedy production-first order.
 */
export function selectAiBuildingPlacement(
  state: GameState,
  map: GameMap,
  playerId: string,
  difficulty: AiDifficulty,
): { territoryId: string; buildingType: BuildingType } | null {
  if (difficulty === 'easy' || difficulty === 'tutorial') return null;
  if (!state.settings.economy_enabled) return null;

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const owned = Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === playerId)
    .map(([id]) => id);
  if (owned.length === 0) return null;

  const checkTechUnlocked = (bType: BuildingType): boolean => {
    if (!state.settings.tech_trees_enabled) return true;
    const tree = getEraTechTree(state.era);
    const requiring = tree.find((n) => n.unlocks_building === bType);
    if (!requiring) return true;
    return (player.unlocked_techs ?? []).includes(requiring.tech_id);
  };

  const tryBuild = (
    bType: BuildingType,
    candidates: string[],
  ): { territoryId: string; buildingType: BuildingType } | null => {
    const techUnlocked = checkTechUnlocked(bType);
    if (!techUnlocked) return null;
    for (const tid of candidates) {
      const result = validateBuild(state, playerId, tid, bType, techUnlocked);
      if (result.valid) return { territoryId: tid, buildingType: bType };
    }
    return null;
  };

  if (difficulty === 'hard' || difficulty === 'expert') {
    const adjacency = buildAdjacencyMap(map);

    // Find most-threatened border territories (ordered by total enemy units adjacent).
    const borderTerritories = owned
      .map((tid) => {
        const neighbors = adjacency[tid] ?? [];
        const enemyUnits = neighbors
          .filter(
            (nid) =>
              state.territories[nid]?.owner_id !== playerId &&
              state.territories[nid]?.owner_id !== null,
          )
          .reduce((s, nid) => s + (state.territories[nid]?.unit_count ?? 0), 0);
        return { tid, enemyUnits };
      })
      .filter((x) => x.enemyUnits > 0)
      .sort((a, b) => b.enemyUnits - a.enemyUnits);

    // Defense on the most-threatened undefended border territory first.
    for (const { tid } of borderTerritories) {
      const existing = state.territories[tid].buildings ?? [];
      if (!existing.some((b) => b.startsWith('defense'))) {
        const result = tryBuild('defense_1', [tid]);
        if (result) return result;
      }
    }

    // Then production / tech on highest-unit territories.
    const byUnits = [...owned].sort(
      (a, b) => state.territories[b].unit_count - state.territories[a].unit_count,
    );
    for (const bType of [
      'production_1', 'production_2', 'production_3',
      'tech_gen_1', 'tech_gen_2',
      'defense_2', 'defense_3',
    ] as BuildingType[]) {
      const result = tryBuild(bType, byUnits);
      if (result) return result;
    }
    return null;
  }

  // medium: greedy production-first on the least-developed territory.
  const byFewBuildings = [...owned].sort(
    (a, b) =>
      (state.territories[a].buildings?.length ?? 0) -
      (state.territories[b].buildings?.length ?? 0),
  );
  for (const bType of [
    'production_1', 'tech_gen_1', 'defense_1',
    'production_2', 'tech_gen_2', 'defense_2',
    'production_3', 'defense_3',
  ] as BuildingType[]) {
    const result = tryBuild(bType, byFewBuildings);
    if (result) return result;
  }
  return null;
}

/**
 * Choose a tech node to research this AI turn, or null to skip.
 * Easy/tutorial never researches.
 * Hard/expert selects strategically based on era aggression profile;
 * medium picks the cheapest affordable node.
 */
export function selectAiTechResearch(
  state: GameState,
  playerId: string,
  difficulty: AiDifficulty,
): string | null {
  if (difficulty === 'easy' || difficulty === 'tutorial') return null;
  if (!state.settings.tech_trees_enabled) return null;

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const tree = getEraTechTree(state.era);
  const unlocked = player.unlocked_techs ?? [];
  const techPoints = player.tech_points ?? 0;

  const available = tree.filter(
    (node) =>
      !unlocked.includes(node.tech_id) &&
      node.cost <= techPoints &&
      (!node.prerequisite || unlocked.includes(node.prerequisite)),
  );
  if (available.length === 0) return null;

  if (difficulty === 'hard' || difficulty === 'expert') {
    const isAggressive = AGGRESSIVE_ERAS.has(state.era);
    const scored = available.map((node) => {
      let score = 0;
      if (isAggressive) {
        score += (node.attack_bonus ?? 0) * 3;
        score += (node.defense_bonus ?? 0) * 1;
      } else {
        score += (node.attack_bonus ?? 0) * 1;
        score += (node.defense_bonus ?? 0) * 3;
      }
      score += (node.tech_point_income ?? 0) * 2;
      score += (node.reinforce_bonus ?? 0) * 2;
      // Slightly prefer lower tiers (more accessible).
      score -= (node.tier - 1) * 0.5;
      return { node, score };
    });
    scored.sort((a, b) => b.score - a.score || a.node.cost - b.node.cost);
    return scored[0]?.node.tech_id ?? null;
  }

  // medium: cheapest affordable node.
  available.sort((a, b) => a.cost - b.cost);
  return available[0]?.tech_id ?? null;
}

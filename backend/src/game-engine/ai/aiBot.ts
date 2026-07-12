import { randomInt } from 'crypto';
import type { GameState, GameMap, AiDifficulty, BuildingType } from '../../types';
import { calculateReinforcements } from '../combat/combatResolver';
import { calculateContinentBonuses } from '../state/gameStateManager';
import { getAllowedVictoryConditions } from '../state/gameSettings';
import { getEraTechTree } from '../eras';
import { getPlayerFaction } from '../eras/factionLineage';
import { resolvePlayerEraId } from '../eraAdvancement/constants';
import { getEffectiveMilestoneGate } from '../eraAdvancement/spines';
import { countUnlockedTechsByTier } from '../eraAdvancement/eraAdvancementReadiness';
import { vulnerabilityAttackBonus } from './aiEraAdvancement';
import { validateBuild, countPlayerBuildings } from '../state/economyManager';
import {
  connectionRequiresMoonAccess,
  getOrbitAccessResult,
  isLaneSealedForPlayer,
} from '../state/moonAccess';

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
    // Tutorial AI uses the CSPRNG for parity with the rest of the engine.
    // Cosmetic for tutorial outcomes, but lets us audit the codebase as
    // "no Math.random in gameplay" — the only Math.random calls left in
    // aiBot are heuristic jitter for non-tutorial difficulties, where
    // determinism is intentionally absent.
    const target = owned.length > 0 ? owned[randomInt(0, owned.length)] : undefined;
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
    !(state.influence_cooldown_remaining ?? 0)
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
    const faction = getPlayerFaction(state, player);
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

/**
 * Endgame finisher: weight attacks that can knock a crippled opponent out of
 * the game so 1–2 territory players don't linger for hundreds of turns.
 * Easy (and tutorial) AI stays forgiving and gets no bonus.
 */
export function eliminationAttackBonus(
  state: GameState,
  defenderOwnerId: string | null,
  difficulty: AiDifficulty,
): number {
  if (!defenderOwnerId || difficulty === 'easy' || difficulty === 'tutorial') return 0;
  const owner = state.players.find((p) => p.player_id === defenderOwnerId);
  if (!owner || owner.is_eliminated) return 0;
  const remaining = owner.territory_count ?? 0;
  if (remaining === 1) return 5;
  if (remaining === 2) return 2.5;
  return 0;
}

/** Extra attacks allowed past the per-difficulty cap when a kill is on the board. */
const FINISHER_OVERCAP = 4;

/**
 * Score nudge for attacking a neutral Era-Advancement frontier territory. Claiming
 * free frontier land is strategically valuable (more territories → more
 * reinforcements + region bonuses), so the AI should reliably grab adjacent weak
 * frontiers rather than only ever fighting other players. Scales with difficulty so
 * stronger bots expand more decisively; still below a kill-shot so finishing an
 * opponent wins. The old flat +1 was too weak to overcome the sea-lane drag, so
 * newly-unlocked island frontiers (Hawaii, the archipelagos) sat uncaptured.
 */
const NEUTRAL_EXPANSION_BONUS_BY_DIFFICULTY: Record<AiDifficulty, number> = {
  tutorial: 1,
  easy: 1.5,
  medium: 2,
  hard: 2.5,
  expert: 3,
};

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

  const aiPlayer = state.players.find((p) => p.player_id === playerId);

  // Compute orbit/hyperspace access once per turn — orbit-typed edges that the
  // server would reject (Space Age moon, Galactic Age hyperspace) should never
  // populate the candidate shortlist. Otherwise the AI silently wastes its
  // per-turn attack budget on edges the runtime aborts before resolving combat.
  const hasOrbitAccess = aiPlayer
    ? getOrbitAccessResult(state, aiPlayer, map, state.era).allowed
    : true;

  // Build list of viable attacks sorted by favorability
  const candidates: { from: string; to: string; score: number; isFinisher: boolean }[] = [];

  // Track planned sea-attack count per source so we don't over-commit fleets.
  // (Each sea attack consumes 1 fleet; the runtime aborts attacks beyond the
  // available fleet count, which silently wastes the AI's attack budget.)
  const plannedSeaAttacksFrom = new Map<string, number>();

  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id !== playerId || tState.unit_count < 2) continue;
    const neighbors = adjacency[tid] || [];
    for (const nid of neighbors) {
      const nState = state.territories[nid];
      if (!nState || nState.owner_id === playerId) continue;

      // Check truce
      const nOwner = nState.owner_id;
      if (nOwner && isTruceActive(state, playerId, nOwner)) continue;

      // Neutral targets: Earth frontiers (Era Advancement growth) are capturable
      // only in era-advancement games; neutral OFF-WORLD garrisons (the Moon)
      // are capturable once this AI holds orbit access — the same rule the
      // runtime applies in executeLandAttack. Skip un-capturable neutrals so
      // the AI doesn't waste its per-turn attack budget on rejected attacks.
      const targetIsNeutral = !nOwner;
      if (targetIsNeutral) {
        const targetOffworld = !!nState.world_id && nState.world_id !== 'earth';
        if (targetOffworld) {
          if (!hasOrbitAccess) continue;
        } else if (!state.settings.era_advancement_enabled) {
          continue;
        }
      }

      const attackUnits = tState.unit_count - 1;

      // Determine effective attack dice (era-aware)
      const conn = map.connections.find(
        (c) => (c.from === tid && c.to === nid) || (c.from === nid && c.to === tid)
      );
      const isSeaConn = conn?.type === 'sea';

      // Orbit gating: skip orbit-typed connections when the AI lacks the
      // era-appropriate access (Lunar Expansion + Launch Pad + Space Station,
      // or Hyperspace Chart / Hyperlane Anchor / Helion Navigator faction).
      if (!hasOrbitAccess && connectionRequiresMoonAccess(map, tid, nid)) continue;

      // Galaxy: don't waste attacks on a hyperspace lane a rival has sealed.
      if (isLaneSealedForPlayer(state, tid, nid, playerId)) continue;

      // Naval gating: when naval warfare is enabled, sea-lane attacks require
      // the source territory to hold at least one fleet (one is consumed per
      // attack). Skip candidates we can't actually launch — otherwise they
      // pollute the score-sorted shortlist and starve land attacks of the
      // AI's per-turn attack budget.
      if (state.settings.naval_enabled && isSeaConn) {
        const fleetsAvailable = tState.naval_units ?? 0;
        const alreadyPlanned = plannedSeaAttacksFrom.get(tid) ?? 0;
        if (fleetsAvailable - alreadyPlanned <= 0) continue;
      }

      const isSeaLane = state.era_modifiers?.sea_lanes && isSeaConn;
      const isPrecision = state.era_modifiers?.precision_strike && tState.unit_count >= 4;
      const attackDice = isPrecision ? 3 : isSeaLane ? Math.min(attackUnits, 2) : Math.min(attackUnits, 3);
      const defDice = Math.min(nState.unit_count, 2);

      // Simple favorability: attacker dice advantage
      // Sea-lane attacks get a slight penalty for the reduced dice
      const seaPenalty = isSeaLane ? -0.5 : 0;
      const objectiveBonus = attackObjectiveBonus(state, playerId, nid);
      const vulnBonus = vulnerabilityAttackBonus(state, nOwner, difficulty);
      const finisherBonus = eliminationAttackBonus(state, nOwner, difficulty);
      let expansionBonus = 0;
      if (targetIsNeutral) {
        expansionBonus = NEUTRAL_EXPANSION_BONUS_BY_DIFFICULTY[difficulty] ?? 2;
        // Many newly-unlocked frontiers (Hawaii, the island archipelagos) are
        // reachable only across sea lanes, which pay the reduced-dice + seaPenalty
        // drag below. Offset it for neutral grabs so the AI actually claims them
        // instead of always preferring a land-adjacent fight.
        if (isSeaLane) expansionBonus += 1.5;
      }
      const score = (attackDice - defDice) + seaPenalty + objectiveBonus + vulnBonus + finisherBonus + expansionBonus + Math.random() * randomFactor * 3;
      if (score > 0 || difficulty === 'easy') {
        candidates.push({ from: tid, to: nid, score, isFinisher: finisherBonus > 0 });
        if (state.settings.naval_enabled && isSeaConn) {
          plannedSeaAttacksFrom.set(tid, (plannedSeaAttacksFrom.get(tid) ?? 0) + 1);
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Kill-shots may exceed the per-turn attack budget (except easy/tutorial):
  // leaving a 1-territory opponent alive because the cap ran out is the main
  // way solo games dragged into hundreds of turns.
  const allowFinisherOvercap = difficulty !== 'easy' && difficulty !== 'tutorial';
  let picked = 0;
  for (const candidate of candidates) {
    const overCap = picked >= maxAttacks;
    if (overCap && !(allowFinisherOvercap && candidate.isFinisher && picked < maxAttacks + FINISHER_OVERCAP)) {
      continue;
    }
    const { from, to } = candidate;
    const fromState = state.territories[from];
    if (!fromState || fromState.unit_count < 2) continue;
    const attackUnits = Math.min(fromState.unit_count - 1, 3);
    actions.push({ type: 'attack', from, to, units: attackUnits });
    picked++;
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
 * Score AI-owned coastal territories as port-build candidates. Higher score =
 * better target. Returns territories ordered best-first; only territories
 * with at least one enemy-owned sea neighbor are returned (no point building
 * a port that can't be used to project force).
 *
 * Used by `selectAiBuildingPlacement` when `naval_enabled` is on so the AI
 * actually builds the prerequisite for sea-lane invasions instead of letting
 * its sea-locked frontiers go unchallenged forever.
 */
function rankPortCandidates(
  state: GameState,
  map: GameMap,
  playerId: string,
): { tid: string; score: number; existing: string[] }[] {
  const ranked: { tid: string; score: number; existing: string[] }[] = [];
  for (const t of map.territories) {
    const tid = t.territory_id;
    const tState = state.territories[tid];
    if (!tState || tState.owner_id !== playerId) continue;
    if (tState.naval_units == null) continue; // not coastal
    const existing = tState.buildings ?? [];

    // Score based on enemy territories reachable via sea connections.
    let enemySeaTargets = 0;
    let weakSeaTargets = 0;
    for (const conn of map.connections) {
      if (conn.type !== 'sea') continue;
      const otherId = conn.from === tid ? conn.to : conn.to === tid ? conn.from : null;
      if (!otherId) continue;
      const other = state.territories[otherId];
      if (!other || other.owner_id === playerId || other.owner_id == null) continue;
      enemySeaTargets += 1;
      if (other.unit_count <= 3) weakSeaTargets += 1;
    }
    if (enemySeaTargets === 0) continue;

    // Score: number of viable sea-lane targets (heavily weighted), bonus for
    // weak defenders, plus a small bias toward high-unit attacker territories
    // so the fleets we produce end up where we have units to launch with.
    const score = enemySeaTargets * 3 + weakSeaTargets * 2 + tState.unit_count * 0.1;
    ranked.push({ tid, score, existing });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

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
  if (difficulty === 'tutorial') return null;
  if (!state.settings.economy_enabled) return null;
  // Easy stays passive in normal games, but must build in era-advancement games
  // or it can never satisfy the gate's building requirement (steamroll bug).
  if (difficulty === 'easy' && !state.settings.era_advancement_enabled) return null;

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const owned = Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === playerId)
    .map(([id]) => id);
  if (owned.length === 0) return null;

  const checkTechUnlocked = (bType: BuildingType): boolean => {
    if (!state.settings.tech_trees_enabled) return true;
    const tree = getEraTechTree(resolvePlayerEraId(state, player));
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

  const leastDeveloped = (): string[] => [...owned].sort(
    (a, b) =>
      (state.territories[a].buildings?.length ?? 0) -
      (state.territories[b].buildings?.length ?? 0),
  );

  // Easy bots (only reachable here in era-advancement games): build the cheapest
  // available building until the milestone gate's requirement is met, then stop.
  if (difficulty === 'easy') {
    const gate = getEffectiveMilestoneGate(state, playerId);
    if (countPlayerBuildings(state, playerId) >= gate.min_buildings) return null;
    for (const bType of ['production_1', 'tech_gen_1', 'defense_1'] as BuildingType[]) {
      const result = tryBuild(bType, leastDeveloped());
      if (result) return result;
    }
    return null;
  }

  // ── Space program priority ────────────────────────────────────────────────
  // Space Age: the Launch Pad is the physical rung of the Moon ladder (tech →
  // Launch Pad → Space Station → Lunar Expansion). Build it as soon as the
  // tech is in hand — without it the AI can never finish the orbit-access race
  // (tryBuild validates the tech unlock, so this no-ops until then).
  if (
    state.era === 'space_age'
    && !owned.some((tid) => state.territories[tid].buildings?.includes('launch_pad'))
  ) {
    const byUnits = [...owned].sort(
      (a, b) => state.territories[b].unit_count - state.territories[a].unit_count,
    );
    const result = tryBuild('launch_pad', byUnits);
    if (result) return result;
  }

  // ── Naval priority ────────────────────────────────────────────────────────
  // When naval warfare is enabled, the AI must build ports before it can
  // attack via sea lanes (each sea attack consumes a fleet, and fleets only
  // accrue from ports / naval bases). If the AI has any coastal territory
  // adjacent to an enemy by sea but no port yet, building one is more
  // valuable than another production tile because it unlocks an entire
  // axis of attack the AI otherwise cannot use.
  if (state.settings.naval_enabled) {
    const portCandidates = rankPortCandidates(state, map, playerId);
    const hasAnyPort = portCandidates.some(
      (c) => c.existing.includes('port') || c.existing.includes('naval_base'),
    );

    // Step 1: build a fresh port on the highest-scoring candidate that lacks one.
    const needPortAt = portCandidates.find(
      (c) => !c.existing.includes('port') && !c.existing.includes('naval_base'),
    );
    if (needPortAt && !hasAnyPort) {
      const result = tryBuild('port', [needPortAt.tid]);
      if (result) return result;
    }

    // Step 2 (hard/expert): once the AI has at least one port, upgrade the
    // best-positioned existing port to a naval_base for double fleet income,
    // then start adding coastal_battery defense at fleet-producing tiles.
    if (difficulty === 'hard' || difficulty === 'expert') {
      const upgradeAt = portCandidates.find(
        (c) => c.existing.includes('port') && !c.existing.includes('naval_base'),
      );
      if (upgradeAt) {
        const result = tryBuild('naval_base', [upgradeAt.tid]);
        if (result) return result;
      }
      const fortifyAt = portCandidates.find(
        (c) => (c.existing.includes('port') || c.existing.includes('naval_base'))
          && !c.existing.includes('coastal_battery'),
      );
      if (fortifyAt) {
        const result = tryBuild('coastal_battery', [fortifyAt.tid]);
        if (result) return result;
      }
    }
  }

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
      'production_1', 'production_2', 'production_3', 'production_4',
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
    'production_3', 'defense_3', 'production_4',
  ] as BuildingType[]) {
    const result = tryBuild(bType, byFewBuildings);
    if (result) return result;
  }
  return null;
}

type AvailableTech = ReturnType<typeof getEraTechTree>[number];

/**
 * Era-advancement gate-directed research: pick the cheapest affordable tech that
 * advances the player toward the milestone gate (fill tier-1 to the requirement,
 * then tier-2, then tier-3). Returns null once the gate's TECH requirements are
 * met, so the caller can fall back to its normal strategic/cheapest selection.
 *
 * Without this, low/medium AIs research cheapest-first and may never accumulate
 * the specific tier-2/tier-3 techs the gate demands — leaving them frozen in the
 * starting era while a human climbs.
 */
function selectGateDirectedTech(
  state: GameState,
  playerId: string,
  available: AvailableTech[],
): string | null {
  const gate = getEffectiveMilestoneGate(state, playerId);
  const t1 = countUnlockedTechsByTier(state, playerId, 1, 1);
  const t2 = countUnlockedTechsByTier(state, playerId, 2, 2);
  const t3 = countUnlockedTechsByTier(state, playerId, 3, 3);
  const cheapestOfTier = (tier: number): string | undefined =>
    available.filter((n) => n.tier === tier).sort((a, b) => a.cost - b.cost)[0]?.tech_id;

  if (t1 < gate.min_tier1_techs) return cheapestOfTier(1) ?? null;
  // Need tier-2: take an available tier-2, else research more tier-1 to unlock its prerequisites.
  if (t2 < gate.min_tier2_techs) return cheapestOfTier(2) ?? cheapestOfTier(1) ?? null;
  if (gate.min_tier3_techs > 0 && t3 < gate.min_tier3_techs) {
    return cheapestOfTier(3) ?? cheapestOfTier(2) ?? cheapestOfTier(1) ?? null;
  }
  return null;
}

/**
 * Choose a tech node to research this AI turn, or null to skip.
 * Tutorial never researches. Easy researches only in era-advancement games
 * (gate-directed, so it can actually climb). Hard/expert select strategically;
 * medium picks the cheapest affordable node. In era-advancement games every
 * researching difficulty prioritizes the advancement gate first.
 */
export function selectAiTechResearch(
  state: GameState,
  playerId: string,
  difficulty: AiDifficulty,
): string | null {
  if (difficulty === 'tutorial') return null;
  if (!state.settings.tech_trees_enabled) return null;
  // Easy stays passive in normal games, but must research in era-advancement
  // games or it can never pass the gate (steamroll bug). Galactic Age is the
  // other exception: it has no era advancement, so a non-Helion easy bot that
  // never researches can never unlock hyperspace lanes and is permanently
  // locked to its home world. Easy falls through to the galaxy hook below,
  // which lets it buy the Hyperspace Chart and nothing else.
  if (difficulty === 'easy' && !state.settings.era_advancement_enabled && state.era !== 'galaxy_age') {
    return null;
  }

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;

  const playerEra = resolvePlayerEraId(state, player);
  const tree = getEraTechTree(playerEra);
  const unlocked = player.unlocked_techs ?? [];
  const techPoints = player.tech_points ?? 0;

  let available = tree.filter(
    (node) =>
      !unlocked.includes(node.tech_id) &&
      node.cost <= techPoints &&
      (!node.prerequisite || unlocked.includes(node.prerequisite)),
  );
  if (available.length === 0) return null;

  // Era advancement: climb the milestone gate before anything else.
  if (state.settings.era_advancement_enabled) {
    const gateTech = selectGateDirectedTech(state, playerId, available);
    if (gateTech) return gateTech;
    // Easy bots only research toward the gate — stay simple once it's satisfied.
    if (difficulty === 'easy') return null;
  }

  // Galactic Age priority hook: Hyperspace Chart has no raw combat numbers, so
  // the score-based path below would never pick it; without it the AI is
  // permanently locked out of orbit attacks. Jump it (and any prereq it still
  // needs) to the front of the queue when the AI can't reach foreign worlds.
  if (state.era === 'galaxy_age') {
    const factionOpenLanes = player.faction_id === 'helion_navigators';
    const hasAnchor = Object.values(state.territories ?? {}).some(
      (t) =>
        t.owner_id === playerId &&
        (t.buildings?.includes('wonder_hyperlane_anchor') ?? false),
    );
    const hasChart = unlocked.includes('ga_hyperspace_chart');
    if (!hasChart && !factionOpenLanes && !hasAnchor) {
      const chart = available.find((n) => n.tech_id === 'ga_hyperspace_chart');
      if (chart) return chart.tech_id;
      // Fall back to the prereq if Hyperspace Chart itself isn't yet affordable.
      const chartNode = tree.find((n) => n.tech_id === 'ga_hyperspace_chart');
      if (chartNode?.prerequisite) {
        const prereq = available.find((n) => n.tech_id === chartNode.prerequisite);
        if (prereq) return prereq.tech_id;
      }
    } else {
      // Lane access is already granted (Helion faction, Hyperlane Anchor, or
      // the chart itself) — the chart is pure waste now, but the generic
      // cheapest/score paths below would still buy it (observed live: Helion
      // medium bots burning 5 TP on it). Drop it from the candidate pool.
      available = available.filter((n) => n.tech_id !== 'ga_hyperspace_chart');
      if (available.length === 0) return null;
    }
    // Easy bots in the Galactic Age research the chart and nothing else —
    // they only reach this function for the world-lock exception above.
    if (difficulty === 'easy' && !state.settings.era_advancement_enabled) return null;
  }

  // Space Age priority hook (mirror of the galaxy hook above): the lunar
  // ladder (Orbital Recon → Launch Pad tech → Orbital Station → Lunar
  // Expansion) carries no raw combat numbers, so the score-based path below
  // never picks it and the AI would be permanently locked out of the Moon
  // race. Walk the ladder from the top target down its prerequisite chain and
  // research the deepest node that is available now. Skipped for Lunar
  // Pioneers (access is faction-granted) and on boards with no off-world
  // territory to race for.
  if (state.era === 'space_age' && player.faction_id !== 'lunar_pioneers'
      && !unlocked.includes('sa_lunar_expansion')) {
    const hasOffworld = Object.values(state.territories).some(
      (t) => !!t.world_id && t.world_id !== 'earth',
    );
    if (hasOffworld) {
      let cur: string | undefined = 'sa_lunar_expansion';
      const walked = new Set<string>();
      while (cur && !walked.has(cur)) {
        walked.add(cur);
        if (unlocked.includes(cur)) break;
        const researchable = available.find((n) => n.tech_id === cur);
        if (researchable) return cur;
        cur = tree.find((n) => n.tech_id === cur)?.prerequisite;
      }
    }
  }

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

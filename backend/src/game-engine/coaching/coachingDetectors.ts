/**
 * In-turn coaching detectors.
 *
 * Each detector inspects the current game state and returns either a
 * `CoachingTip` or `null`. The dispatcher evaluates detectors in priority
 * order and surfaces *at most one* tip per turn — the highest-priority
 * detector that fires wins. When no detector matches, no tip is emitted
 * (intentional: silence is preferable to spam).
 *
 * Priority rationale (1 = highest):
 *   1. probability_drop      — a recent setback is the most diagnostically
 *                              useful tip; players don't always notice
 *                              probability shifts in the chart.
 *   2. opponent_region_threat — defensive threats are time-critical; missing
 *                              the chance to block a region bonus is one of
 *                              the most common game-losing oversights.
 *   3. region_opportunity    — offensive opportunities are valuable but less
 *                              urgent than blocking opponent gains.
 *   4. thin_border           — situational; ignored if any higher-priority
 *                              tip is active (otherwise too noisy).
 */

import type {
  CoachingTip,
  CoachingTipCategory,
  GameMap,
  GameState,
  PlayerState,
  TerritoryState,
} from '../../types';

const PROBABILITY_DROP_THRESHOLD = 0.05;
const REGION_PROGRESS_THRESHOLD = 0.7;
/** Resign suggestion: win probability below this … */
const RESIGN_PROBABILITY_THRESHOLD = 0.05;
/** … for this many consecutive snapshots (one per round). */
const RESIGN_SNAPSHOT_STREAK = 10;

interface DetectorContext {
  state: GameState;
  map: GameMap;
  human: PlayerState;
  ownedByPlayer: Map<string, Set<string>>;
}

type Detector = (ctx: DetectorContext) => CoachingTip | null;

function buildOwnedByPlayer(state: GameState): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const player of state.players) result.set(player.player_id, new Set());
  for (const territory of Object.values(state.territories)) {
    if (!territory.owner_id) continue;
    const set = result.get(territory.owner_id);
    if (set) set.add(territory.territory_id);
  }
  return result;
}

/**
 * Detector 0 — The game has been effectively lost for a long stretch:
 * win probability under RESIGN_PROBABILITY_THRESHOLD for the last
 * RESIGN_SNAPSHOT_STREAK consecutive snapshots. Fires at most once per game
 * (the dispatcher stamps `resign_suggestion_shown` after emitting). The tip
 * only ever *suggests* — resigning stays a player decision with the normal
 * confirmation flow.
 */
const resignSuggestionDetector: Detector = ({ state, human }) => {
  if (state.resign_suggestion_shown) return null;
  const history = state.win_probability_history ?? [];
  if (history.length < RESIGN_SNAPSHOT_STREAK) return null;

  const recent = history.slice(-RESIGN_SNAPSHOT_STREAK);
  for (const snapshot of recent) {
    const prob = snapshot.probabilities[human.player_id];
    if (prob == null || prob >= RESIGN_PROBABILITY_THRESHOLD) return null;
  }

  return {
    turn: state.turn_number,
    category: 'resign_suggestion',
    title: 'This one looks out of reach',
    body: `Your win probability has been under ${Math.round(RESIGN_PROBABILITY_THRESHOLD * 100)}% for ${RESIGN_SNAPSHOT_STREAK} rounds. Fighting on is always your call — comebacks happen — but resigning ends it cleanly and gets you into a fresh match sooner.`,
  };
};

/** Detector 1 — Win probability dropped meaningfully last turn. */
const probabilityDropDetector: Detector = ({ state, human }) => {
  const history = state.win_probability_history ?? [];
  if (history.length < 2) return null;

  // Find the most recent two snapshots that include the human (history is
  // already chronological).
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const probLast = last.probabilities[human.player_id];
  const probPrev = prev.probabilities[human.player_id];
  if (probLast == null || probPrev == null) return null;

  const drop = probPrev - probLast;
  if (drop < PROBABILITY_DROP_THRESHOLD) return null;

  const beforePct = Math.round(probPrev * 100);
  const afterPct = Math.round(probLast * 100);
  return {
    turn: state.turn_number,
    category: 'probability_drop',
    title: 'Your position weakened last turn',
    body: `Your win probability dropped from ${beforePct}% to ${afterPct}%. Consider consolidating before pressing on offense — thin frontlines compound losses quickly.`,
  };
};

/** Detector 2 — An opponent is one or two captures from completing a region. */
const opponentRegionThreatDetector: Detector = ({ state, map, human }) => {
  let bestThreat: {
    opponentName: string;
    regionName: string;
    bonus: number;
    needed: number;
  } | null = null;

  for (const region of map.regions) {
    if (region.bonus <= 0) continue;
    const territoriesInRegion = map.territories.filter((t) => t.region_id === region.region_id);
    if (territoriesInRegion.length === 0) continue;

    const threatByOwner = new Map<string, number>();
    for (const t of territoriesInRegion) {
      const ownerId = state.territories[t.territory_id]?.owner_id;
      if (!ownerId || ownerId === human.player_id) continue;
      threatByOwner.set(ownerId, (threatByOwner.get(ownerId) ?? 0) + 1);
    }

    for (const [ownerId, owned] of threatByOwner) {
      const progress = owned / territoriesInRegion.length;
      if (progress < REGION_PROGRESS_THRESHOLD) continue;
      const needed = territoriesInRegion.length - owned;
      // Prefer the largest pending threat (highest bonus, then fewest needed).
      const better =
        !bestThreat ||
        region.bonus > bestThreat.bonus ||
        (region.bonus === bestThreat.bonus && needed < bestThreat.needed);
      if (better) {
        const opponent = state.players.find((p) => p.player_id === ownerId);
        bestThreat = {
          opponentName: opponent?.username ?? 'an opponent',
          regionName: region.name,
          bonus: region.bonus,
          needed,
        };
      }
    }
  }

  if (!bestThreat) return null;

  const tip: CoachingTip = {
    turn: state.turn_number,
    category: 'opponent_region_threat',
    title: `Block ${bestThreat.opponentName} in ${bestThreat.regionName}`,
    body: `${bestThreat.opponentName} is ${bestThreat.needed} territor${bestThreat.needed === 1 ? 'y' : 'ies'} from completing ${bestThreat.regionName} (+${bestThreat.bonus} units/turn). Consider taking or reinforcing one of those territories before they secure the bonus.`,
  };
  return tip;
};

/** Detector 3 — Player is one or two captures from completing a region. */
const regionOpportunityDetector: Detector = ({ state, map, human, ownedByPlayer }) => {
  let best: {
    regionName: string;
    bonus: number;
    needed: number;
  } | null = null;

  const humanOwned = ownedByPlayer.get(human.player_id) ?? new Set<string>();

  for (const region of map.regions) {
    if (region.bonus <= 0) continue;
    const territoriesInRegion = map.territories.filter((t) => t.region_id === region.region_id);
    if (territoriesInRegion.length === 0) continue;

    const owned = territoriesInRegion.filter((t) => humanOwned.has(t.territory_id)).length;
    if (owned === territoriesInRegion.length) continue; // already complete

    const progress = owned / territoriesInRegion.length;
    if (progress < REGION_PROGRESS_THRESHOLD) continue;
    const needed = territoriesInRegion.length - owned;
    const better =
      !best ||
      region.bonus > best.bonus ||
      (region.bonus === best.bonus && needed < best.needed);
    if (better) {
      best = {
        regionName: region.name,
        bonus: region.bonus,
        needed,
      };
    }
  }

  if (!best) return null;

  return {
    turn: state.turn_number,
    category: 'region_opportunity',
    title: `Complete ${best.regionName} for +${best.bonus}`,
    body: `You are ${best.needed} territor${best.needed === 1 ? 'y' : 'ies'} from completing ${best.regionName}. Securing it grants +${best.bonus} units/turn — usually the highest-leverage objective on the map.`,
  };
};

/**
 * Detector 4 — A border territory you own has only 1 unit and sits next to
 * at least one enemy territory. Surfaced as a defensive nudge.
 */
const thinBorderDetector: Detector = ({ state, map, human }) => {
  const adjacency = new Map<string, string[]>();
  for (const conn of map.connections) {
    if (!adjacency.has(conn.from)) adjacency.set(conn.from, []);
    if (!adjacency.has(conn.to)) adjacency.set(conn.to, []);
    adjacency.get(conn.from)!.push(conn.to);
    adjacency.get(conn.to)!.push(conn.from);
  }

  let weakest: TerritoryState | null = null;
  let weakestNeighbors = 0;
  for (const territory of Object.values(state.territories)) {
    if (territory.owner_id !== human.player_id) continue;
    if (territory.unit_count > 1) continue;
    const neighbors = adjacency.get(territory.territory_id) ?? [];
    let enemyNeighbors = 0;
    for (const adjId of neighbors) {
      const adjOwner = state.territories[adjId]?.owner_id;
      if (adjOwner && adjOwner !== human.player_id) enemyNeighbors++;
    }
    if (enemyNeighbors === 0) continue;
    if (enemyNeighbors > weakestNeighbors) {
      weakest = territory;
      weakestNeighbors = enemyNeighbors;
    }
  }

  if (!weakest) return null;

  const territoryName =
    map.territories.find((t) => t.territory_id === weakest!.territory_id)?.name ??
    weakest.territory_id;

  return {
    turn: state.turn_number,
    category: 'thin_border',
    title: 'Reinforce a vulnerable border',
    body: `${territoryName} has only 1 unit and borders ${weakestNeighbors} enemy territor${weakestNeighbors === 1 ? 'y' : 'ies'}. Consider deploying reinforcements there during this draft phase.`,
  };
};

/** Detectors in priority order. The first one that produces a tip wins. */
const DETECTORS: Detector[] = [
  resignSuggestionDetector,
  probabilityDropDetector,
  opponentRegionThreatDetector,
  regionOpportunityDetector,
  thinBorderDetector,
];

/**
 * Run all detectors in priority order and return the first tip that fires,
 * or null if no detector finds anything noteworthy.
 *
 * The caller is responsible for verifying eligibility (1 human + all AI +
 * unranked + setting opted in); this function does not gate on those.
 */
export function evaluateCoachingTip(state: GameState, map: GameMap): CoachingTip | null {
  const human = state.players.find((p) => !p.is_ai && !p.is_eliminated);
  if (!human) return null;

  // Only emit at the start of the human's draft phase — that's the moment
  // they can actually act on the advice (deploy reinforcements, decide
  // attack targets, etc.).
  if (state.phase !== 'draft') return null;
  if (state.players[state.current_player_index]?.player_id !== human.player_id) return null;

  const ctx: DetectorContext = {
    state,
    map,
    human,
    ownedByPlayer: buildOwnedByPlayer(state),
  };

  for (const detector of DETECTORS) {
    const tip = detector(ctx);
    if (tip) return tip;
  }
  return null;
}

/** Test helper: list all category ids in priority order. */
export const DETECTOR_PRIORITY: CoachingTipCategory[] = [
  'resign_suggestion',
  'probability_drop',
  'opponent_region_threat',
  'region_opportunity',
  'thin_border',
];

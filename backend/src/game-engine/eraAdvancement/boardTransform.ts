/**
 * Era board TRANSFORM (Phase 2 core).
 *
 * When a game advances into the next era, the shared board recomposes onto that
 * era's map. Per the locked design ("successors go neutral"):
 *   • Every territory of the arriving era's board spawns NEUTRAL + garrisoned —
 *     the new world is up for grabs (reusing the era-growth frontier mechanic).
 *   • EXCEPT a single SEED per surviving player, so no one is wiped to zero
 *     territories (which would mean instant elimination) by the recomposition.
 *
 * A player's seed is the successor — via the precomputed era→era lineage — of
 * their strongest current territory: the place their empire's core "becomes" on
 * the new map. Stronger empires pick first; if a player's successors are all
 * taken, they fall back to any unclaimed territory so they always keep a foothold.
 *
 * This module is the pure, side-effect-light heart of the transform: seed
 * assignment + the new neutral board. The socket/persistence/client wiring and
 * the per-game trigger live in the caller (gameRoomManager / gameSocket).
 */
import { inferWorldId } from '@borderfall/shared';
import type { EraId, GameMap, GameState, TerritoryState } from '../../types';
import type { EraTransition } from './eraLineage';
import { getPrimarySuccessor } from './eraLineage';
import { buildCardDeck, syncTerritoryCounts } from '../state/gameStateManager';
import { assignCapitals, assignSecretMissions } from '../victory/missions';

/** Garrison on a freshly-neutral territory of the arriving era (scales with era depth, capped). */
export function neutralGarrisonForEra(eraIndex: number): number {
  return Math.min(8, 2 + Math.max(1, eraIndex));
}
/** Starting garrison on a player's retained seed — a real foothold, not a token. */
export function seedGarrisonForEra(eraIndex: number): number {
  return Math.min(8, Math.max(3, neutralGarrisonForEra(eraIndex)));
}

/** Total fighting strength a player currently fields — drives seed pick order. */
function playerStrength(state: GameState, playerId: string): number {
  let s = 0;
  for (const t of Object.values(state.territories)) if (t.owner_id === playerId) s += t.unit_count;
  return s;
}

/**
 * Assign each surviving player a single SEED territory on the arriving board.
 *
 * @param inPlayTargets  the arriving era's territory ids that will be in play.
 * @returns Map<playerId, seedTerritoryId>. Every non-eliminated player with at
 *          least one territory gets exactly one seed (guaranteed foothold).
 */
export function assignSeeds(
  state: GameState,
  transition: EraTransition,
  inPlayTargets: Set<string>,
): Map<string, string> {
  const seeds = new Map<string, string>();
  const claimed = new Set<string>();

  // Survivors who currently hold ground, strongest empire first (deterministic
  // tiebreak by player_id keeps the result reproducible).
  const survivors = state.players
    .filter((p) => !p.is_eliminated && Object.values(state.territories).some((t) => t.owner_id === p.player_id))
    .map((p) => ({ id: p.player_id, strength: playerStrength(state, p.player_id) }))
    .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));

  for (const { id } of survivors) {
    // The player's territories, strongest first (tiebreak by id for determinism).
    const owned = Object.values(state.territories)
      .filter((t) => t.owner_id === id)
      .sort((a, b) => b.unit_count - a.unit_count || a.territory_id.localeCompare(b.territory_id));

    let seed: string | undefined;
    // Prefer the lineage successor of the player's strongest territory, walking
    // weaker territories until an unclaimed, in-play successor is found.
    for (const t of owned) {
      const succ = getPrimarySuccessor(transition, t.territory_id)
        ?? transition.lineage[t.territory_id]?.find((e) => inPlayTargets.has(e.to) && !claimed.has(e.to))?.to;
      const candidate = succ && inPlayTargets.has(succ) && !claimed.has(succ) ? succ : undefined;
      // Also consider every successor of this territory, not just the primary.
      const anyFree = candidate
        ?? transition.lineage[t.territory_id]?.find((e) => inPlayTargets.has(e.to) && !claimed.has(e.to))?.to;
      if (anyFree) { seed = anyFree; break; }
    }
    // Fallback: no successor free → claim any unclaimed in-play territory so the
    // player is never eliminated by the transform itself.
    if (!seed) {
      seed = [...inPlayTargets].sort().find((tid) => !claimed.has(tid));
    }
    if (seed) {
      seeds.set(id, seed);
      claimed.add(seed);
    }
  }
  return seeds;
}

export interface BoardTransformSummary {
  to_map: string;
  era_index: number;
  total: number;
  neutral: number;
  seeds: { player_id: string; territory_id: string }[];
}

/**
 * Recompose `state.territories` onto the arriving era's board: all neutral +
 * garrisoned except each surviving player's seed. Mutates `state` (territories,
 * map_id) and returns a summary for the client morph event. `inPlayTargets`
 * lets the caller decide the arriving era's visible set (full board vs floor).
 */
export function transformBoardToEra(
  state: GameState,
  nextMap: GameMap,
  nextEraIndex: number,
  transition: EraTransition,
  inPlayTargets: Set<string>,
): BoardTransformSummary {
  const seeds = assignSeeds(state, transition, inPlayTargets);
  const seedOwnerByTarget = new Map([...seeds].map(([pid, tid]) => [tid, pid]));

  const territories: Record<string, TerritoryState> = {};
  let neutral = 0;
  for (const t of nextMap.territories) {
    if (!inPlayTargets.has(t.territory_id)) continue;
    const seedOwner = seedOwnerByTarget.get(t.territory_id) ?? null;
    if (!seedOwner) neutral += 1;
    territories[t.territory_id] = {
      territory_id: t.territory_id,
      owner_id: seedOwner,
      unit_count: seedOwner ? seedGarrisonForEra(nextEraIndex) : neutralGarrisonForEra(nextEraIndex),
      unit_type: 'infantry',
      world_id: inferWorldId(t),
      region_id: t.region_id,
    };
  }

  state.territories = territories;
  state.map_id = nextMap.map_id;

  return {
    to_map: nextMap.map_id,
    era_index: nextEraIndex,
    total: Object.keys(territories).length,
    neutral,
    seeds: [...seeds].map(([player_id, territory_id]) => ({ player_id, territory_id })),
  };
}

export interface BoardTransformResult extends BoardTransformSummary {
  from_era_index: number;
}

/**
 * Full board transform with every invariant fixup so the recomposed state is
 * internally consistent — the single entry point the trigger (gameRoomManager /
 * gameSocket, Phase 2b) calls. Recomposes the board onto `nextMap`, then repairs
 * the denormalized / territory-referencing state a mid-game board swap would
 * otherwise corrupt (territory counts, capitals, cards, secret missions, and the
 * per-turn transient references that point at now-gone territories).
 *
 * `rng` drives secret-mission reassignment (caller passes a seeded rng). Mutates
 * `state`; returns a summary for the client morph event.
 */
export function executeBoardTransform(
  state: GameState,
  nextMap: GameMap,
  nextEraIndex: number,
  transition: EraTransition,
  inPlayTargets: Set<string>,
  rng: () => number,
): BoardTransformResult {
  const fromEraIndex = state.board_era_index ?? 0;
  const summary = transformBoardToEra(state, nextMap, nextEraIndex, transition, inPlayTargets);

  // Board-era bookkeeping. Transform supersedes growth, so pin map_era_floor to
  // the new index too — globalEraFloor-driven growth then never re-fires on top.
  state.board_era_index = nextEraIndex;
  state.map_era_floor = nextEraIndex;
  // Game-wide era reflects the board so era theming/UI follow the new world.
  state.era = nextMap.map_id.replace(/^era_/, '') as EraId;

  // ── Invariant fixups (see the Phase-2 board-swap invariant analysis) ──
  // 1) Denormalized territory_count drives reinforcement + victory checks.
  syncTerritoryCounts(state);
  // 2) Capitals: a player now owns only their seed → capital must point at it
  //    (assignCapitals picks the first owned id, i.e. the seed). Stale capitals
  //    break AI scoring + capital-victory detection.
  assignCapitals(state);
  // 3) Territory cards carry territory_ids; the whole set changed. Rebuild the
  //    draw deck for the new board and drop the now-orphaned discard pile. Player
  //    hands keep their symbols (set-redemption still works); a stale territory_id
  //    in hand simply yields no own-territory bonus (never crashes).
  state.card_deck = buildCardDeck(Object.keys(state.territories));
  state.discard_pile = [];
  // 4) Secret missions reference territory/region ids; regenerate for the new
  //    world so no player is handed an impossible (deleted-territory) objective.
  if (state.settings.victory_type === 'secret_mission') {
    assignSecretMissions(state, nextMap, rng);
  }
  // 5) Per-turn transients that point at territories that no longer exist.
  state.draft_placements_this_turn = {};
  state.blitzkrieg_active = false;
  state.blitzkrieg_bonus_source_id = null;
  state.blitzkrieg_bonus_attacks_remaining = 0;
  for (const p of state.players) {
    p.march_to_sea_last_capture_id = null;
  }

  return { ...summary, from_era_index: fromEraIndex };
}

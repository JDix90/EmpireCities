/**
 * Where a bot's reinforcements go (ai_planned_reinforcements_enabled).
 *
 * Today the plan is made before the turn's builds, research, era advance,
 * card trades and faction abilities, so it does not know how many units the
 * turn really has, and it puts all of them on one tile: the border tile most
 * outnumbered by its neighbours, a defensive choice the attack plan never
 * uses. With the flag on, the turn calls allocateDraft once those steps are
 * done, with the true count, and places units in chunks. Each chunk goes to
 * the tile where it adds the most:
 *
 *   attack   the rise in the capture chance on the best target the tile can
 *            reach, times what that target is worth (1, plus a third of the
 *            planner's strategic bonus: an objective, a kill shot, free land);
 *   defence  the fall in the chance that the strongest rival stack beside the
 *            tile takes it next round.
 *
 * A level spreads its draft over at most `draftTiles` tiles (ai/aiProfiles.ts),
 * more only once those are at their stability caps; a level with none keeps
 * the plan's single tile, and the turn never calls this for it. Today only Expert has any: placing by value is strong enough
 * to make Expert the clear top level on its own. Attacks are then chosen
 * again on the board as it stands after placement, at levels that do
 * (runAiTurn.ts).
 */
import type { GameMap, GameState } from '../../types';
import { captureProbability, type CaptureOddsOptions } from '../combat/combatOdds';
import { getPlayerEraModifiers } from '../state/eraModifiers';
import { getDeployCap } from '../state/stabilityManager';
import { isJumpGateOnlyEdge } from '../state/jumpGates';
import { connectionRequiresMoonAccess, getOrbitAccessResult, isLaneSealedForPlayer } from '../state/moonAccess';
import { isShieldedFrom } from '../state/teams';
import { getWorldRules, worldDeployCapBonus } from '../state/worldRules';
import { vulnerabilityAttackBonus } from './aiEraAdvancement';
import { attackObjectiveBonus, buildAdjacencyMap, eliminationAttackBonus, isTruceActive } from './aiBot';
import { edgeOddsOptions } from './aiEdgeOdds';
import { endingAttackBonus, type EndingPlan } from './aiEnding';
import { aiProfile, type AiLevel } from './aiProfiles';

export interface DraftPlacement {
  to: string;
  units: number;
}

/** The draft is placed in at most this many chunks, so a big draft costs no more to plan than a small one. */
const MAX_CHUNKS = 12;

interface AttackOption {
  /** The target's defenders. */
  defenders: number;
  /** What taking it is worth: 1, plus a third of the planner's strategic bonus. */
  worth: number;
  odds: CaptureOddsOptions;
}

interface Threat {
  /** The rival stack that could attack this tile next round. */
  attackers: number;
  odds: CaptureOddsOptions;
}

/**
 * Split `units` reinforcements across the player's territories. Placements
 * are in the order the units were chosen, largest first; their sum is
 * `units` unless the player holds nothing, or every territory is at its
 * stability cap.
 */
export function allocateDraft(
  state: GameState,
  map: GameMap,
  playerId: string,
  units: number,
  difficulty: AiLevel,
  ending?: EndingPlan,
): DraftPlacement[] {
  if (units <= 0) return [];
  const profile = aiProfile(difficulty);
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return [];
  const adjacency = buildAdjacencyMap(map);
  const owned = Object.entries(state.territories).filter(([, t]) => t.owner_id === playerId);
  if (owned.length === 0) return [];

  const hasOrbitAccess = getOrbitAccessResult(state, player, map, state.era).allowed;
  const eraModifiers = getPlayerEraModifiers(state, playerId);

  // What each tile could attack, and what could attack it, priced once.
  const attackOptions = new Map<string, AttackOption[]>();
  const threats = new Map<string, Threat[]>();
  for (const [tid, t] of owned) {
    const attacks: AttackOption[] = [];
    const against: Threat[] = [];
    for (const nid of adjacency[tid] ?? []) {
      const n = state.territories[nid];
      if (!n || n.owner_id === playerId) continue;
      if (isJumpGateOnlyEdge(map, tid, nid)) continue;
      const conn = map.connections.find(
        (c) => (c.from === tid && c.to === nid) || (c.from === nid && c.to === tid),
      );
      const isSea = conn?.type === 'sea';
      const owner = n.owner_id;
      const hostile = !!owner && !isShieldedFrom(state, playerId, owner) && !isTruceActive(state, playerId, owner);

      // As the planner gates its attacks (aiBot selectAttacks).
      const offworldNeutral = !owner && !!n.world_id && n.world_id !== 'earth';
      const canAttack =
        (hostile || (!owner && n.unit_count >= 1 && (!offworldNeutral || hasOrbitAccess)))
        && (hasOrbitAccess || !connectionRequiresMoonAccess(map, tid, nid))
        && !(isLaneSealedForPlayer(state, tid, nid, playerId) && player.pending_seal_breaker_from !== tid)
        && !(state.settings.naval_enabled && isSea && (t.naval_units ?? 0) <= 0);
      if (canAttack) {
        const seaLane = !!eraModifiers.sea_lanes && isSea;
        let strategic = (seaLane ? -0.5 : 0)
          + attackObjectiveBonus(state, map, playerId, nid)
          + vulnerabilityAttackBonus(state, owner, profile)
          + eliminationAttackBonus(state, owner, profile);
        if (ending) {
          const e = endingAttackBonus(state, ending, nid);
          strategic += e.value + e.rank;
        }
        if (!owner) strategic += profile.neutralExpansionBonus + (seaLane ? 1.5 : 0);
        attacks.push({
          defenders: n.unit_count,
          worth: 1 + Math.max(0, strategic) / 3,
          odds: edgeOddsOptions(state, map, playerId, tid, nid, Math.max(2, t.unit_count), n.unit_count),
        });
      }
      // A rival stack that can reach this tile next round.
      if (hostile && n.unit_count >= 2 && !(state.settings.naval_enabled && isSea && (n.naval_units ?? 0) <= 0)) {
        against.push({
          attackers: n.unit_count,
          odds: edgeOddsOptions(state, map, owner!, nid, tid, n.unit_count, Math.max(1, t.unit_count)),
        });
      }
    }
    if (attacks.length > 0) attackOptions.set(tid, attacks);
    if (against.length > 0) threats.set(tid, against);
  }

  // Galaxy storms (Verdan): a stack past the world's threshold only feeds the
  // weather, so a tile there takes no more (as the planner's draft target).
  const room = (tid: string, placed: number): number => {
    const t = state.territories[tid]!;
    const storm = getWorldRules(state, t.world_id).storm_threshold;
    if (storm != null && t.unit_count + placed >= storm) return 0;
    if (!state.settings.stability_enabled) return Number.POSITIVE_INFINITY;
    const cap = getDeployCap(t.stability, {
      era: state.era,
      turnNumber: state.turn_number,
      economyEnabled: !!state.settings.economy_enabled,
      playerSpecialResource: player.special_resource ?? 0,
      worldDeployCapBonus: worldDeployCapBonus(state, t.world_id),
    });
    return Math.max(0, cap - (state.draft_placements_this_turn?.[tid] ?? 0) - placed);
  };

  const attackValue = (tid: string, stack: number): number => {
    let best = 0;
    for (const a of attackOptions.get(tid) ?? []) {
      best = Math.max(best, a.worth * captureProbability(stack, a.defenders, a.odds));
    }
    return best;
  };
  const lossChance = (tid: string, defenders: number): number => {
    let worst = 0;
    for (const r of threats.get(tid) ?? []) {
      worst = Math.max(worst, captureProbability(r.attackers, defenders, r.odds));
    }
    return worst;
  };

  const placed = new Map<string, number>();
  const candidates = owned
    .map(([tid]) => tid)
    .filter((tid) => attackOptions.has(tid) || threats.has(tid));
  // Nothing borders anything: every unit to the largest stack, as good as any.
  if (candidates.length === 0) {
    const [biggest] = [...owned].sort((a, b) => b[1].unit_count - a[1].unit_count)[0]!;
    return [{ to: biggest, units }];
  }

  const best = (open: Iterable<string>, size: number): string | null => {
    let bestTid: string | null = null;
    let bestGain = -1;
    for (const tid of open) {
      const already = placed.get(tid) ?? 0;
      const fits = Math.min(size, room(tid, already));
      if (fits <= 0) continue;
      const now = state.territories[tid]!.unit_count + already;
      const gain =
        attackValue(tid, now + fits) - attackValue(tid, now)
        + lossChance(tid, now) - lossChance(tid, now + fits);
      if (gain > bestGain) {
        bestGain = gain;
        bestTid = tid;
      }
    }
    return bestTid;
  };

  const chunk = Math.max(1, Math.ceil(units / MAX_CHUNKS));
  let left = units;
  while (left > 0) {
    const size = Math.min(chunk, left);
    const full = placed.size >= Math.max(1, profile.draftTiles);
    // Once the level's tiles are at their stability caps, open the next best
    // one rather than leave the rest to the turn's fallback, which spreads
    // them a unit at a time over every tile it holds.
    const bestTid = best(full ? placed.keys() : candidates, size) ?? (full ? best(candidates, size) : null);
    if (!bestTid) break;
    const fits = Math.min(size, room(bestTid, placed.get(bestTid) ?? 0));
    placed.set(bestTid, (placed.get(bestTid) ?? 0) + fits);
    left -= fits;
  }

  return [...placed.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([to, n]) => ({ to, units: n }));
}

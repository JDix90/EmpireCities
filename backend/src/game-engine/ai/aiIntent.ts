/**
 * A bot's intent (ai_intents_enabled): one goal that spans turns.
 *
 * Today the planner scores each turn on its own: it never values a region,
 * so a bot two tiles from a whole continent attacks wherever the odds are
 * best, and a rival's finished continent is just more tiles. With the flag
 * on, a bot picks one of three goals as its turn opens:
 *
 *   take_region   a region it already has a foothold in, by the income it
 *                 would pay against what is left to take;
 *   break_region  a region a rival holds whole, by the income it denies
 *                 against the cheapest way in;
 *   hunt          a rival down to its last few territories, by what knocking
 *                 it out is worth (its cards go to whoever takes its last
 *                 tile) against everything it has left. Never by its hand,
 *                 which no player can see.
 *
 * The goal then weighs the turn: captures that advance it are worth more,
 * and for a region to take or a rival to hunt, its draft stages beside it
 * and its fortify move heads for it (intentStages).
 *
 * It is chosen again every turn from the board as it stands, and the goal it
 * already holds only wins a near tie (the level's `intentStickiness`): a
 * goal is a tie-breaker, never a contract, so a bot does not march into a
 * wall to keep it. It reads only what the seat may see: under fog of war a
 * hidden garrison counts as HIDDEN_UNITS.
 *
 * Never for a human seat the AI covers while its player is away, in team
 * games, or where the game keeps today's bots (ai/aiProfiles.ts
 * keepsTodaysBots). The goal is never sent to a client; the digest of the
 * bot's turn (ai/aiTurnDigest.ts) names it, at levels that tell it.
 */
import type { AiIntent, GameMap, GameState } from '../../types';
import { scaleRegionBonus } from '../combat/combatResolver';
import { isFriendlyOwner, isShieldedFrom, isTeamGame } from '../state/teams';
import { buildAdjacencyMap, isTruceActive } from './aiBot';
import { aiProfile, type AiLevel } from './aiProfiles';

export type { AiIntent };
export type AiIntentKind = AiIntent['kind'];

/** A garrison the seat cannot see, under fog of war, counts as this many units. */
export const HIDDEN_UNITS = 3;
/** Turns of a region's income that taking or breaking it is worth. ⚠ balance */
export const REGION_HORIZON = 3;
/** Breaking a rival's region is worth this share of taking one: it gains the bot nothing itself. ⚠ balance */
export const BREAK_WEIGHT = 0.75;
/** A rival with this many territories or fewer can be hunted. */
export const HUNT_TILES = 3;
/** Knocking a rival out, in units: one fewer rival, and its cards. ⚠ balance */
export const HUNT_VALUE = 8;
/** Draft score for a tile beside the goal, in units, like a gateway's premium. ⚠ balance */
export const INTENT_DRAFT_PREMIUM = 4;

interface Candidate {
  kind: AiIntentKind;
  target: string;
  score: number;
}

const garrison = (units: number) => (units >= 0 ? units : HIDDEN_UNITS);

/**
 * The goal `playerId` plays toward this turn, or null when it has none: a
 * level without intents, a game that keeps today's bots, a team game, or a
 * board where no goal is in reach. `previous` is the goal it held, which
 * wins a near tie and keeps its `since`.
 */
export function chooseIntent(
  state: GameState,
  map: GameMap,
  playerId: string,
  difficulty: AiLevel,
  previous?: AiIntent | null,
): AiIntent | null {
  const profile = aiProfile(difficulty);
  if (profile.passive || profile.intentBonus <= 0 || isTeamGame(state)) return null;
  const me = state.players.find((p) => p.player_id === playerId);
  if (!me || me.is_eliminated) return null;

  const adjacency = buildAdjacencyMap(map);
  const hostile = (owner: string | null | undefined): boolean =>
    !!owner && owner !== playerId && !isFriendlyOwner(state, playerId, owner)
    && !isShieldedFrom(state, playerId, owner) && !isTruceActive(state, playerId, owner);
  // A tile the bot can attack now: beside one of its own.
  const inReach = (tid: string): boolean =>
    (adjacency[tid] ?? []).some((nid) => state.territories[nid]?.owner_id === playerId);

  const candidates: Candidate[] = [];

  // Regions, counting only the territories in play (a growing board's
  // locked frontier counts for nobody, as in calculateContinentBonuses).
  const regionTiles = new Map<string, string[]>();
  for (const t of map.territories) {
    if (!state.territories[t.territory_id]) continue;
    const list = regionTiles.get(t.region_id) ?? [];
    list.push(t.territory_id);
    regionTiles.set(t.region_id, list);
  }
  for (const region of map.regions) {
    const tiles = regionTiles.get(region.region_id);
    const income = scaleRegionBonus(region.bonus, state.players.length);
    if (!tiles || tiles.length === 0 || income <= 0) continue;
    const owners = tiles.map((tid) => state.territories[tid]!.owner_id);
    const value = income * REGION_HORIZON;

    const mine = owners.filter((o) => o === playerId).length;
    if (mine > 0 && mine < tiles.length) {
      // Take: every tile left must be one the bot may attack, and one in reach now.
      const missing = tiles.filter((tid) => state.territories[tid]!.owner_id !== playerId);
      const takeable = missing.every((tid) => {
        const owner = state.territories[tid]!.owner_id;
        return !owner || hostile(owner);
      });
      if (takeable && missing.some(inReach)) {
        const effort = missing.reduce((s, tid) => s + garrison(state.territories[tid]!.unit_count) + 1, 0);
        candidates.push({ kind: 'take_region', target: region.region_id, score: value / effort });
      }
    }

    const holder = owners[0];
    if (holder && hostile(holder) && owners.every((o) => o === holder)) {
      // Break: the cheapest tile of it in reach.
      const entries = tiles.filter(inReach);
      if (entries.length > 0) {
        const effort = Math.min(...entries.map((tid) => garrison(state.territories[tid]!.unit_count) + 1));
        candidates.push({ kind: 'break_region', target: region.region_id, score: (BREAK_WEIGHT * value) / effort });
      }
    }
  }

  // Hunt: a rival nearly out, with a tile in reach.
  if (profile.finisher) {
    for (const rival of state.players) {
      if (rival.is_eliminated || !hostile(rival.player_id)) continue;
      const tiles = Object.entries(state.territories).filter(([, t]) => t.owner_id === rival.player_id);
      if (tiles.length === 0 || tiles.length > HUNT_TILES) continue;
      if (!tiles.some(([tid]) => inReach(tid))) continue;
      const effort = tiles.reduce((s, [, t]) => s + garrison(t.unit_count) + 1, 0);
      candidates.push({ kind: 'hunt', target: rival.player_id, score: HUNT_VALUE / effort });
    }
  }

  let best: Candidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const held = previous && previous.kind === c.kind && previous.target === c.target;
    const score = c.score * profile.goalWeights[c.kind] * (held ? 1 + profile.intentStickiness : 1);
    // Ties go to the first in a fixed order (regions in map order, then
    // seats), so a seeded game picks the same goal on every machine.
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best) return null;
  const kept = previous && previous.kind === best.kind && previous.target === best.target;
  return { kind: best.kind, target: best.target, since: kept ? previous.since : state.turn_number };
}

/**
 * Whether the goal pulls the draft and the fortify move toward it: taking a
 * region and hunting do, breaking one does not. Measured in four-seat Hard
 * tables (scripts/simAiArena.ts): staging for every goal won 40% against
 * three Hard bots without goals, but with goals at every seat the median
 * game ran 24 rounds against 19. Staging only to take and to hunt won 39%
 * and 33% on two seeds, and ran 21 and 20 rounds against 19 and 21.
 */
export function intentStages(intent: AiIntent | null | undefined): intent is AiIntent {
  return !!intent && intent.kind !== 'break_region';
}

/** Whether taking `targetId` advances `intent`: a tile of its region, or one of its quarry's. */
export function advancesIntent(
  state: GameState,
  map: GameMap,
  intent: AiIntent | null | undefined,
  targetId: string,
): boolean {
  if (!intent) return false;
  if (intent.kind === 'hunt') return state.territories[targetId]?.owner_id === intent.target;
  return regionOf(map, targetId) === intent.target;
}

/**
 * The goal's weight on taking `targetId`, on the planner's 3·P − 1 scale: the
 * level's `intentBonus` for a capture that advances it, else nothing. It is
 * part of what a capture is worth, so it may start a fight the bot would
 * otherwise pass up, as racing the ending does.
 */
export function intentAttackBonus(
  state: GameState,
  map: GameMap,
  intent: AiIntent | null | undefined,
  targetId: string,
  difficulty: AiLevel,
): number {
  return advancesIntent(state, map, intent, targetId) ? aiProfile(difficulty).intentBonus : 0;
}

const regionCache = new WeakMap<GameMap['territories'], Map<string, string>>();

function regionOf(map: GameMap, territoryId: string): string | undefined {
  let byId = regionCache.get(map.territories);
  if (!byId) {
    byId = new Map(map.territories.map((t) => [t.territory_id, t.region_id]));
    regionCache.set(map.territories, byId);
  }
  return byId.get(territoryId);
}

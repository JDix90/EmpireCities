/**
 * Where a bot moves its troops at the end of its turn (ai_defense_enabled).
 *
 * Today's move (aiBot selectFortify) is one move, planned before the draft
 * and the attacks, from an interior tile to the nearest border. Planned
 * fortify is chosen at the fortify step, on the board the attacks left, and
 * uses every move the bot has (techAbilities getFortifyMoveLimit). Each move
 * is the one that gains the most:
 *
 *   defence  the fall in the chance its destination is lost before the bot's
 *            next turn (ai/aiThreat.ts), less the rise at its source;
 *   staging  at levels that stage (`fortifyAttackWeight`), the rise in the
 *            best capture the destination could make next turn, as the draft
 *            prices it (ai/aiDraftPlan.ts), less what the source gives up.
 *
 * Any tile with troops to spare can send them, a border tile too, and a move
 * goes only where a player's could (state/fortifyRoute.ts). A move between
 * two worlds would arrive a turn late, as a convoy, so it is not planned.
 * Planning stops when no move gains anything.
 */
import type { GameMap, GameState } from '../../types';
import { fortifyRouteAllowed } from '../state/fortifyRoute';
import { fortifyBecomesConvoy } from '../state/transit';
import { bestAttackValue, priceFronts } from './aiDraftPlan';
import type { EndingPlan } from './aiEnding';
import type { AiIntent } from './aiIntent';
import { aiProfile, type AiLevel } from './aiProfiles';
import { buildThreatMap, lossChance } from './aiThreat';

export interface FortifyMove {
  from: string;
  to: string;
  units: number;
}

/** A move must gain at least this much, in tiles' worth, to be made. */
const MIN_GAIN = 0.01;
/**
 * What each unit moved costs, in tiles' worth: between two moves that gain
 * about the same, the smaller wins, and keeps troops back for the next move.
 */
const UNIT_COST = 0.002;
/** A tile this unlikely to be lost is as safe as more troops can make it. */
const SAFE = 0.05;
/** At most this many tiles are considered as sources for each move, those with the most to spare. */
const MAX_SOURCES = 16;

/** The fortify moves `playerId` makes, at most `moves` of them, best first, on the board `state` shows. */
export function planFortify(
  state: GameState,
  map: GameMap,
  playerId: string,
  difficulty: AiLevel,
  opts: { moves: number; ending?: EndingPlan; intent?: AiIntent },
): FortifyMove[] {
  const profile = aiProfile(difficulty);
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || opts.moves <= 0) return [];
  const threats = buildThreatMap(state, map, playerId, profile.threatModel);
  const weight = profile.fortifyAttackWeight;
  const { attackOptions } = weight > 0
    ? priceFronts(state, map, playerId, difficulty, opts.ending, opts.intent)
    : { attackOptions: new Map() };

  const units = new Map<string, number>();
  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.owner_id === playerId) units.set(tid, t.unit_count);
  }
  // A tile worth reinforcing: one a rival could take, or one that could attack.
  const fronts = [...units.keys()].filter((tid) => threats.stacks.has(tid) || attackOptions.has(tid));

  /** What the tile is worth holding `n` units: its chance of being kept, plus its best capture, weighted. */
  const worth = (tid: string, n: number): number =>
    -lossChance(threats, tid, n) + (weight > 0 ? weight * bestAttackValue(attackOptions.get(tid), n) : 0);

  const refused = new Set<string>();
  const moves: FortifyMove[] = [];
  while (moves.length < opts.moves) {
    const sources = [...units.entries()]
      .filter(([tid, n]) => n >= 2 && !moves.some((m) => m.to === tid))
      .sort((a, b) => (b[1] - worthToKeep(b[0], b[1])) - (a[1] - worthToKeep(a[0], a[1])))
      .slice(0, MAX_SOURCES);
    let best: (FortifyMove & { gain: number }) | null = null;
    for (const [from, have] of sources) {
      const keepNow = worth(from, have);
      for (const to of fronts) {
        if (to === from || refused.has(`${from}>${to}`)) continue;
        if (fortifyBecomesConvoy(state, from, to)) continue;
        const there = units.get(to)!;
        const toNow = worth(to, there);
        for (const k of amounts(have - 1, (n) => lossChance(threats, to, there + n), profile.lossTolerance)) {
          const gain = worth(to, there + k) - toNow + worth(from, have - k) - keepNow - UNIT_COST * k;
          if (gain > (best?.gain ?? MIN_GAIN)) best = { from, to, units: k, gain };
        }
      }
    }
    if (!best) break;
    if (!fortifyRouteAllowed(state, map, player, best.from, best.to)) {
      refused.add(`${best.from}>${best.to}`);
      continue;
    }
    units.set(best.from, units.get(best.from)! - best.units);
    units.set(best.to, units.get(best.to)! + best.units);
    moves.push({ from: best.from, to: best.to, units: best.units });
  }
  return moves;

  /** The units a tile would want to keep for itself: enough to bring its own loss chance under tolerance. */
  function worthToKeep(tid: string, n: number): number {
    if (!threats.stacks.has(tid)) return 0;
    for (let k = 1; k <= n; k += 1) {
      if (lossChance(threats, tid, k) <= profile.lossTolerance) return k;
    }
    return n;
  }
}

/**
 * The move sizes worth pricing from a tile with `spare` units to send: all of
 * them, half, the fewest that bring the destination under tolerance, and the
 * fewest that make it safe.
 */
function amounts(spare: number, lossWith: (n: number) => number, tolerance: number): number[] {
  if (spare <= 0) return [];
  const out = new Set<number>([spare, Math.ceil(spare / 2)]);
  let underTolerance = false;
  for (let k = 1; k <= spare; k += 1) {
    const loss = lossWith(k);
    if (!underTolerance && loss <= tolerance) {
      out.add(k);
      underTolerance = true;
    }
    if (loss <= SAFE) {
      out.add(k);
      break;
    }
  }
  return [...out];
}

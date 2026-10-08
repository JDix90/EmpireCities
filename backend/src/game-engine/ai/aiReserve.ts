/**
 * What a tile a bot attacks from keeps back (ai_defense_enabled, the level's
 * `sourceReserve`). Today a bot presses an attack while the odds hold and
 * moves into what it takes, so the tile it attacked from is left thin beside
 * every other rival stack: the tiles bots lose most are those they attacked
 * from.
 *
 * The reserve is a share of the tile's threat need: the fewest units that
 * bring its own chance of being lost before the bot's next turn under the
 * level's `lossTolerance` (ai/aiThreat.ts, at the level's `threatModel`),
 * against the stacks beside it of every rival but the one it attacks: the
 * risk in a fight is the third party that walks in while it is weakened. In
 * a duel there is none, and no reserve: one kept against the very rival
 * being attacked lost Expert duels in the arena, where tempo wins. A tile no
 * number of its own units brings under tolerance keeps nothing back: holding
 * it is a lost cause, and its units do more attacking. A reserve of one unit
 * or none changes nothing, since one always stays.
 *
 * How it is spent (ai/aiAttackGrind.ts, combat/executeLandAttack.ts): the
 * attack is priced for the units above the reserve, it starts and continues
 * only while an exchange's losses leave the reserve standing, and the move-in
 * after a capture leaves it behind.
 */
import type { GameMap, GameState } from '../../types';
import { aiProfile, type AiLevel } from './aiProfiles';
import { buildThreatMap, lossChance } from './aiThreat';

/** The attacking units one exchange costs at most without bonus dice (combat/combatResolver.ts: two defender dice). */
export const EXCHANGE_LOSS_MAX = 2;

/** The units the bot's tile `fromId` keeps back while attacking `toId`, on the board `view` shows. */
export function sourceReserve(
  view: GameState,
  map: GameMap,
  playerId: string,
  difficulty: AiLevel,
  fromId: string,
  toId: string,
): number {
  const profile = aiProfile(difficulty);
  if (profile.sourceReserve <= 0) return 0;
  const from = view.territories[fromId];
  if (!from || from.owner_id !== playerId) return 0;
  const threats = buildThreatMap(view, map, playerId, profile.threatModel);
  const defenderId = view.territories[toId]?.owner_id;
  const against = (threats.stacks.get(fromId) ?? []).filter((s) => s.rivalId !== defenderId);
  if (against.length === 0) return 0;
  const own = { ...threats, stacks: new Map([[fromId, against]]) };
  for (let k = 1; k <= from.unit_count; k += 1) {
    if (lossChance(own, fromId, k) <= profile.lossTolerance) {
      const reserve = Math.ceil(k * profile.sourceReserve);
      return reserve > 1 ? reserve : 0;
    }
  }
  return 0;
}

/** The units a source holding `units` attacks with when it keeps `reserve` back: the rest, plus the one that stays. */
export function attackingUnits(units: number, reserve: number): number {
  return reserve > 1 ? Math.max(1, units - reserve + 1) : units;
}

/** Whether one more exchange from a source holding `units` could cut into its reserve. */
export function reserveReached(units: number, reserve: number): boolean {
  return reserve > 1 && units - EXCHANGE_LOSS_MAX < reserve;
}

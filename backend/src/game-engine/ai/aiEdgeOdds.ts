/**
 * The chance a bot takes a territory across one edge, pressing the assault to
 * the end: combat/combatOdds.ts's exact capture probability, fed the dice
 * modifiers the resolver will apply (tech, buildings, factions, wonders, era
 * gaps, garrison doctrines, the sea and lane dice caps). The planner ranks its
 * targets by it, and with ai_odds_press_enabled the turn reads it again from
 * the live board before and between exchanges, so both price a fight alike.
 */
import type { GameMap, GameState } from '../../types';
import { captureProbability, type CaptureOddsOptions } from '../combat/combatOdds';
import { computeLandCombatModifiers } from '../combat/combatModifiers';
import { getPlayerEraModifiers } from '../state/eraModifiers';
import { galaxyLaneAttackDiceCap } from '../state/moonAccess';

/**
 * P(capture) for `attackerId` attacking `toId` from `fromId` with a stack of
 * `attackingUnits` (the source's own count unless given), one of which stays
 * behind as the rules require.
 */
export function edgeCaptureOdds(
  state: GameState,
  map: GameMap,
  attackerId: string,
  fromId: string,
  toId: string,
  attackingUnits?: number,
): number {
  const from = state.territories[fromId];
  const to = state.territories[toId];
  if (!from || !to) return 0;
  const units = attackingUnits ?? from.unit_count;
  return captureProbability(units, to.unit_count, edgeOddsOptions(state, map, attackerId, fromId, toId, units, to.unit_count));
}

/**
 * The dice this edge's fight is rolled with, for captureProbability: the
 * modifiers the resolver applies at these unit counts. A caller pricing the
 * same edge at other counts (where reinforcements go, ai/aiDraftPlan.ts)
 * reuses them rather than recomputing the modifiers for every count.
 */
export function edgeOddsOptions(
  state: GameState,
  map: GameMap,
  attackerId: string,
  fromId: string,
  toId: string,
  attackingUnits: number,
  defendingUnits: number,
): CaptureOddsOptions {
  const to = state.territories[toId];
  const conn = map.connections.find(
    (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId),
  );
  const eraModifiers = getPlayerEraModifiers(state, attackerId);
  const isSeaLane = !!eraModifiers.sea_lanes && conn?.type === 'sea';
  // Galactic Age corridors: a lane crossing rolls at most 2 attacker dice (3
  // with Lane Charts), as the resolver rolls it.
  const laneCap = conn?.type === 'orbit' ? galaxyLaneAttackDiceCap(state, attackerId) : undefined;
  const mods = computeLandCombatModifiers({
    state,
    fromId,
    toId,
    attackerId,
    defenderId: to?.owner_id ?? null,
    attackingUnits,
    defendingUnits,
    connection: conn,
  });
  const defenderPlayer = to?.owner_id
    ? state.players.find((p) => p.player_id === to.owner_id)
    : undefined;
  const vulnActive =
    state.settings.era_advancement_enabled &&
    (defenderPlayer?.era_transition_turns_remaining ?? 0) > 0;
  return {
    attackBonus: mods.attackerBonusBreakdown.total,
    defenseBonus: mods.defenderBonusBreakdown.total,
    // Plan-time approximation: the rare Lighthouse/Naval Charts raise of the
    // sea cap is ignored (slightly conservative on sea assaults).
    attackerBaseCap: isSeaLane ? 2 : laneCap ?? 3,
    maxAttackerDice: state.settings.combat_dice_cap_enabled
      ? state.settings.combat_max_attacker_dice ?? 5
      : undefined,
    maxDefenderDice: state.settings.combat_dice_cap_enabled
      ? state.settings.combat_max_defender_dice ?? 4
      : undefined,
    defenderDiceMult: vulnActive
      ? state.settings.era_advancement_vuln_defense_mult ?? 0.75
      : undefined,
    legionReroll: !!eraModifiers.legion_reroll,
    // Garrison doctrines: a Hardened target defends on d8s, a Forward source
    // attacks on them.
    attackerDieFaces: mods.attackerDieFaces,
    defenderDieFaces: mods.defenderDieFaces,
  };
}

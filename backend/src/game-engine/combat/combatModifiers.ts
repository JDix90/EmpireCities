/**
 * Shared land-combat modifier computation for human and AI attacks.
 *
 * The human `game:attack` handler and the AI attack loop both need to derive the
 * same attacker/defender dice overrides from game state. Historically each path
 * computed these independently, and the AI omitted several modifiers (Discovery
 * sea-lane dice cap, Lighthouse wonder sea dice, precision strike, underdefended
 * bonus, wonder defense). That made identical situations resolve with different
 * odds for humans vs bots. This module is the single source of truth for the
 * **state-derived** modifiers.
 *
 * Side-effecting bonuses (truce break/retaliation, blitzkrieg, consumable attack
 * buffs, March to the Sea chain bonus) are computed by the caller because they
 * mutate state or emit events; the caller passes them in via `extraAttackBonuses`
 * / `extraDefenseBonuses` and they are folded into the totals here.
 */
import type { GameState, MapConnection, PlayerState } from '../../types';
import { getPlayerEraIndex } from '../eraAdvancement/constants';
import { getBuildingDefenseBonus, getSeaDefenseBonus } from '../state/economyManager';
import { getPlayerAttackBonus, getPlayerDefenseBonus } from '../state/techManager';
import { getWonderDefenseBonus, getWonderSeaAttackDice } from '../state/wonderManager';
import { getPlayerFaction } from '../eras/factionLineage';
import { getTemporaryModifierValue } from '../events/eventCardManager';
import {
  attackerIgnoresDefenseBuilding,
  getPrecisionStrikeMinUnits,
  getUnderdefendedAttackDiceBonus,
} from '../abilities/techAbilities';

export interface LandCombatModifierParams {
  state: GameState;
  fromId: string;
  toId: string;
  attackerId: string;
  defenderId: string | null | undefined;
  attackingUnits: number;
  defendingUnits: number;
  connection?: MapConnection;
  /** Attacker already holds a consumable buff that nullifies the defender building bonus. */
  ignoreDefenseBuilding?: boolean;
  /** Side-effect-derived attacker dice (truce retaliation, blitzkrieg, pending extra die, march to the sea). */
  extraAttackBonuses?: Record<string, number>;
  /** Side-effect-derived defender dice (truce break). */
  extraDefenseBonuses?: Record<string, number>;
}

export interface LandCombatModifiers {
  finalAttackerDiceOverride?: number;
  defenderDiceOverride?: number;
  attackerBonusBreakdown: Record<string, number>;
  defenderBonusBreakdown: Record<string, number>;
}

function sumBonuses(bonuses?: Record<string, number>): number {
  if (!bonuses) return 0;
  let total = 0;
  for (const value of Object.values(bonuses)) total += value;
  return total;
}

/**
 * EA-203: the era-gap combat bonus is capped at one era step in each direction.
 * Being 3 eras ahead grants the same dice as being 1 ahead, so a runaway leader
 * can't compound an era lead into an unbounded dice advantage. Returns the
 * signed, clamped gap (positive = attacker ahead).
 */
const MAX_ERA_GAP_STEPS = 1;
function clampedEraGap(state: GameState, attackerId: string, defenderId: string): number {
  const gap = getPlayerEraIndex(state, attackerId) - getPlayerEraIndex(state, defenderId);
  return Math.max(-MAX_ERA_GAP_STEPS, Math.min(MAX_ERA_GAP_STEPS, gap));
}

/**
 * March to the Sea (ACW Total War): once activated, the attacker gets +1 attack die
 * on up to 3 consecutive chain captures. The first hop may originate from any owned
 * territory; subsequent hops must continue from the territory captured in the prior
 * hop. Returns the die bonus (0 or 1) for an attack originating at `fromId`.
 */
export function getMarchToSeaBonus(attacker: PlayerState, fromId: string): number {
  if (!attacker.march_to_sea_active) return 0;
  if ((attacker.march_to_sea_hops_used ?? 0) >= 3) return 0;
  const lastCapture = attacker.march_to_sea_last_capture_id ?? null;
  if (lastCapture !== null && fromId !== lastCapture) return 0;
  return 1;
}

/**
 * Update the attacker's March to the Sea chain state after a land attack resolves.
 * Call once per attack: `bonusApplied` is whether this attack received the +1 chain
 * die (i.e. it was an eligible hop). A successful hop advances the chain; a failed
 * hop breaks it (a fresh chain may begin from any territory while hops remain).
 */
export function recordMarchToSeaResult(
  attacker: PlayerState,
  bonusApplied: boolean,
  toId: string,
  captured: boolean,
): void {
  if (!attacker.march_to_sea_active || !bonusApplied) return;
  if (captured) {
    attacker.march_to_sea_hops_used = (attacker.march_to_sea_hops_used ?? 0) + 1;
    attacker.march_to_sea_last_capture_id = toId;
  } else {
    attacker.march_to_sea_last_capture_id = null;
  }
}

export function computeLandCombatModifiers(params: LandCombatModifierParams): LandCombatModifiers {
  const {
    state,
    toId,
    attackerId,
    defenderId,
    attackingUnits,
    defendingUnits,
    connection,
    ignoreDefenseBuilding,
    extraAttackBonuses,
    extraDefenseBonuses,
  } = params;

  const isSea = connection?.type === 'sea';

  // ── Defender dice ──────────────────────────────────────────────────────────
  const nullifyBuilding = ignoreDefenseBuilding || attackerIgnoresDefenseBuilding(state, attackerId);
  const buildingDefenseBonus = nullifyBuilding ? 0 : getBuildingDefenseBonus(state, toId);
  const techDefenseBonus = state.settings.tech_trees_enabled
    ? getPlayerDefenseBonus(state, defenderId ?? '')
    : 0;
  const defenderFaction = state.settings.factions_enabled
    ? (() => {
        const dp = state.players.find((p) => p.player_id === defenderId);
        return dp ? getPlayerFaction(state, dp) : undefined;
      })()
    : undefined;
  const factionDefenseBonus = defenderFaction?.passive_defense_bonus ?? 0;
  const eventDefenseBonus = state.settings.events_enabled && defenderId
    ? getTemporaryModifierValue(state, defenderId, 'defense_modifier')
    : 0;
  const wonderDefenseBonus = state.settings.economy_enabled
    ? getWonderDefenseBonus(state, defenderId ?? '')
    : 0;
  // Fortify the Coast: coastal_battery grants +1 defense die ONLY on sea attacks.
  const seaDefenseBonus = isSea ? getSeaDefenseBonus(state, toId) : 0;
  const defenderPlayer = defenderId
    ? state.players.find((p) => p.player_id === defenderId)
    : undefined;
  let eraGapDefenseBonus = 0;
  if (state.settings.era_advancement_enabled && defenderId) {
    const gapDice = state.settings.era_advancement_combat_gap_dice ?? 1;
    const effectiveGap = clampedEraGap(state, attackerId, defenderId);
    eraGapDefenseBonus = Math.max(0, -effectiveGap) * gapDice;
  }

  const extraDefenseTotal = sumBonuses(extraDefenseBonuses);
  const totalDefenseBonus =
    buildingDefenseBonus + techDefenseBonus + factionDefenseBonus + eventDefenseBonus
    + wonderDefenseBonus + seaDefenseBonus + eraGapDefenseBonus + extraDefenseTotal;

  const defenderBonusBreakdown: Record<string, number> = {
    building: buildingDefenseBonus,
    tech: techDefenseBonus,
    faction: factionDefenseBonus,
    event: eventDefenseBonus,
    wonder: wonderDefenseBonus,
    sea: seaDefenseBonus,
    era_gap: eraGapDefenseBonus,
    ...(extraDefenseBonuses ?? {}),
    total: totalDefenseBonus,
  };
  // Janissaries (Ottoman) is now a once-per-turn pre-combat charge folded in via
  // `extraDefenseBonuses` (see defenderReactions / executeLandAttack), not an
  // always-on base — so it can no longer make the Ottoman impregnable from turn 1.
  const baseDefenderDice = Math.min(defendingUnits, 2);
  let defenderDiceOverride = totalDefenseBonus > 0
    ? baseDefenderDice + totalDefenseBonus
    : undefined;
  // Anti-fortress cap: clamp the stacked defensive dice to the configured ceiling
  // so building + wonder + faction + tech + bombardment can't make a position
  // impregnable. Applied before the vulnerability reduction below (the cap is the
  // ceiling; situational penalties still lower from there). Never drops below the
  // natural base. Off unless combat_dice_cap_enabled.
  if (state.settings.combat_dice_cap_enabled && defenderDiceOverride !== undefined) {
    const maxDefDice = Math.max(baseDefenderDice, state.settings.combat_max_defender_dice ?? 4);
    if (defenderDiceOverride > maxDefDice) {
      defenderBonusBreakdown.capped = maxDefDice - defenderDiceOverride;
      defenderDiceOverride = maxDefDice;
    }
  }
  if (
    state.settings.era_advancement_enabled
    && (defenderPlayer?.era_transition_turns_remaining ?? 0) > 0
  ) {
    const vulnMult = state.settings.era_advancement_vuln_defense_mult ?? 0.75;
    const preVuln = defenderDiceOverride ?? baseDefenderDice;
    defenderDiceOverride = Math.max(1, Math.floor(preVuln * vulnMult));
    defenderBonusBreakdown.vulnerability = defenderDiceOverride - preVuln;
  }

  // ── Attacker dice ──────────────────────────────────────────────────────────
  const attackerPlayer = state.players.find((p) => p.player_id === attackerId);
  const attackerFaction = state.settings.factions_enabled && attackerPlayer
    ? getPlayerFaction(state, attackerPlayer)
    : undefined;

  // Structural override: Modern precision strike (3 dice) or Discovery sea-lane cap.
  const precisionMinUnits = getPrecisionStrikeMinUnits(state, attackerId);
  const precisionDiceOverride =
    state.era_modifiers?.precision_strike && attackingUnits >= precisionMinUnits
      ? 3
      : undefined;
  const wonderSeaDice = state.settings.economy_enabled && isSea
    ? getWonderSeaAttackDice(state, attackerId)
    : 0;
  // Naval Charts (Portugal): raises the sea-lane attack-dice cap from 2 to 3,
  // matching the Lighthouse wonder. Passive — applies to human and AI alike.
  const baseSeaCap = wonderSeaDice > 0 ? wonderSeaDice : 2;
  const seaCap = attackerFaction?.ability_id === 'naval_charts' ? Math.max(baseSeaCap, 3) : baseSeaCap;
  const seaLanesOverride =
    state.era_modifiers?.sea_lanes && isSea
      ? Math.min(attackingUnits - 1, seaCap)
      : undefined;
  const structuralAttackerDiceOverride = precisionDiceOverride ?? seaLanesOverride;

  const techAttackBonus = state.settings.tech_trees_enabled
    ? getPlayerAttackBonus(state, attackerId)
    : 0;
  const factionAttackBonus = attackerFaction?.passive_attack_bonus ?? 0;
  const eventAttackBonus = state.settings.events_enabled
    ? getTemporaryModifierValue(state, attackerId, 'attack_modifier')
    : 0;
  const underdefendedBonus = getUnderdefendedAttackDiceBonus(state, attackerId, defendingUnits);
  let eraGapAttackBonus = 0;
  if (state.settings.era_advancement_enabled && defenderId) {
    const gapDice = state.settings.era_advancement_combat_gap_dice ?? 1;
    const effectiveGap = clampedEraGap(state, attackerId, defenderId);
    eraGapAttackBonus = Math.max(0, effectiveGap) * gapDice;
  }
  const extraAttackTotal = sumBonuses(extraAttackBonuses);

  const combinedAttackBonus =
    techAttackBonus + factionAttackBonus + eventAttackBonus + underdefendedBonus
    + eraGapAttackBonus + extraAttackTotal;

  const attackerBonusBreakdown: Record<string, number> = {
    tech: techAttackBonus,
    faction: factionAttackBonus,
    event: eventAttackBonus,
    underdefended: underdefendedBonus,
    era_gap: eraGapAttackBonus,
    ...(extraAttackBonuses ?? {}),
    total: combinedAttackBonus,
  };

  let finalAttackerDiceOverride = structuralAttackerDiceOverride !== undefined
    ? structuralAttackerDiceOverride + combinedAttackBonus
    : combinedAttackBonus > 0
      ? Math.min(attackingUnits - 1, 3) + combinedAttackBonus
      : undefined;
  // Anti-fortress cap (attacker side): symmetric ceiling on stacked attack dice.
  if (state.settings.combat_dice_cap_enabled && finalAttackerDiceOverride !== undefined) {
    const baseAtkDice = structuralAttackerDiceOverride ?? Math.min(attackingUnits - 1, 3);
    const maxAtkDice = Math.max(baseAtkDice, state.settings.combat_max_attacker_dice ?? 5);
    if (finalAttackerDiceOverride > maxAtkDice) {
      attackerBonusBreakdown.capped = maxAtkDice - finalAttackerDiceOverride;
      finalAttackerDiceOverride = maxAtkDice;
    }
  }

  return {
    finalAttackerDiceOverride,
    defenderDiceOverride,
    attackerBonusBreakdown,
    defenderBonusBreakdown,
  };
}

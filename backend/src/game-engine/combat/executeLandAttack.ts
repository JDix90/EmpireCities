import type { CombatResult, GameState, MapConnection } from '../../types';
import { consumeAttackBuffs } from '../abilities/executeTechAbility';
import { consumeSignatureAttackBonus } from '../eraAdvancement/signatures';
import { onTerritoryCapture } from '../state/economyManager';
import { onCaptureStabilityPenalty } from '../state/stabilityManager';
import { computeLandCombatModifiers } from './combatModifiers';
import { resolveCombat } from './combatResolver';
import { applyDefenderPostCombatReactions, consumeDefenderPreCombatCharges } from './defenderReactions';

type ConsumedAttackBuffs = ReturnType<typeof consumeAttackBuffs>;
type ConsumedDefenderCharges = ReturnType<typeof consumeDefenderPreCombatCharges>;

export interface ExecuteLandAttackOptions {
  /** Seeded dice for reproducibility; defaults to the engine's CSPRNG. */
  dieRoll?: () => number;
  /** Land connection (used only for sea detection; land-only callers omit it). */
  connection?: MapConnection;
  /**
   * Caller-derived attacker dice bonuses merged with the internally-consumed
   * `pending` (extra attack die) and `era_signature` charge. The socket passes
   * blitzkrieg / march_to_sea / truce_retaliation here; the sim omits them.
   */
  extraAttackBonuses?: Record<string, number>;
  /** Caller-derived defender dice bonuses merged with the internal `great_wall`. */
  extraDefenseBonuses?: Record<string, number>;
  /**
   * True when the attacker holds orbit access (getOrbitAccessResult), allowing
   * capture of NEUTRAL off-world garrisons (Space Age Moon, neutral galaxy
   * worlds). Callers must derive this per-attacker; it is never implied.
   */
  neutralOffworldCaptureAllowed?: boolean;
  /** Called once after a successful capture (e.g. to draw a card). */
  onCapture?: (state: GameState, attackerId: string, toId: string) => void;
}

export interface LandAttackOutcome {
  result: CombatResult;
  captured: boolean;
  defenderEliminated: boolean;
  /** Buffs consumed this exchange — exposed so socket callers can drive visuals/callouts. */
  attackBuffs: ConsumedAttackBuffs;
  /** Era signature attack-die bonus applied this exchange. */
  signatureAttackBonus: number;
  /** Defender pre-combat charges consumed this exchange. */
  defenderCharges: ConsumedDefenderCharges;
  /** Attacker losses BEFORE Testudo negation — the figure combat-ability callouts read. */
  rawAttackerLosses: number;
  /** Pre-attack (precision-strike/air-strike) damage applied to the defender. */
  preAttackDamageApplied: number;
  /** Attacker territory unit count after losses, before any capture move-in. */
  sourceUnitsAfter: number;
}

/**
 * Resolve and apply ONE land combat exchange to game state — the single source
 * of truth for the land path, used by BOTH the socket attack handlers (human +
 * AI) and the headless balance simulator. It runs the full pipeline: attack
 * buffs + era signature charge, defender pre-combat charges, the combat
 * modifiers (incl. era-gap dice and the vulnerability window) merged with any
 * caller-supplied bonuses, resolveCombat, defender post-combat reactions, and
 * capture + stability penalty + elimination.
 *
 * Socket-only concerns stay with the caller, wrapped around this call using the
 * returned metadata: naval crossings, influence, blitzkrieg/march-to-sea state
 * machines, daily-puzzle snapshots, visuals, stat recording, broadcasts, and the
 * once-per-turn card draw (pass `onCapture`).
 *
 * Returns null if the attack is structurally invalid (wrong owner, < 2 units,
 * non-enemy target).
 */
export function executeLandAttack(
  state: GameState,
  attackerId: string,
  fromId: string,
  toId: string,
  opts: ExecuteLandAttackOptions = {},
): LandAttackOutcome | null {
  const from = state.territories[fromId];
  const to = state.territories[toId];
  const attacker = state.players.find((p) => p.player_id === attackerId);
  if (!from || !to || !attacker) return null;
  if (from.owner_id !== attackerId) return null;
  if (to.owner_id === attackerId) return null;
  // Neutral (owner-less) territories are normally not attackable. Two exceptions:
  //  1. Era Advancement grows the board with neutral, garrisoned FRONTIER
  //     territories as players climb eras (eraAdvancement/territoryUnlock.ts);
  //     those must be conquerable in era-advancement games.
  //  2. Neutral OFF-WORLD garrisons (the Space Age Moon, neutral galaxy worlds)
  //     are the prize of the orbit-access race: the caller passes
  //     `neutralOffworldCaptureAllowed` after checking getOrbitAccessResult for
  //     the attacker. Without the flag they stay untouchable — but with it the
  //     race has a finish line (previously this returned null unconditionally,
  //     which made the Moon uncapturable by anyone in every Space Age game).
  // All defender-dependent combat math below already handles a null defender id.
  if (!to.owner_id) {
    const targetIsOffworld = !!to.world_id && to.world_id !== 'earth';
    if (targetIsOffworld) {
      if (!opts.neutralOffworldCaptureAllowed) return null;
    } else if (!state.settings.era_advancement_enabled) {
      return null;
    }
  }
  if (from.unit_count < 2 || to.unit_count < 1) return null;

  const defenderId = to.owner_id;
  const attackBuffs = consumeAttackBuffs(attacker);
  const signatureAttackBonus = consumeSignatureAttackBonus(attacker);
  const defReactions = consumeDefenderPreCombatCharges(state, defenderId);
  if (defReactions.greekFirePreDamage > 0) {
    from.unit_count = Math.max(1, from.unit_count - defReactions.greekFirePreDamage);
  }
  // Janissaries (once per turn): size the bonus so the defender reaches 3 dice
  // regardless of garrison size (3 - base, where base = min(units, 2)).
  const janissariesBonus = defReactions.janissariesActive
    ? Math.max(0, 3 - Math.min(to.unit_count, 2))
    : 0;

  const { finalAttackerDiceOverride, defenderDiceOverride, attackerBonusBreakdown, defenderBonusBreakdown } =
    computeLandCombatModifiers({
      state,
      fromId,
      toId,
      attackerId,
      defenderId,
      attackingUnits: from.unit_count,
      defendingUnits: to.unit_count,
      connection: opts.connection,
      ignoreDefenseBuilding: attackBuffs.ignoreDefenseBuilding,
      extraAttackBonuses: {
        ...(opts.extraAttackBonuses ?? {}),
        pending: attackBuffs.extraAttackDie ? 1 : 0,
        era_signature: signatureAttackBonus,
      },
      extraDefenseBonuses: {
        ...(opts.extraDefenseBonuses ?? {}),
        great_wall: defReactions.greatWallDefenseDice,
        janissaries: janissariesBonus,
      },
    });

  // Precision-strike style pre-attack damage (e.g. the Modern era signature).
  const preAttackDamageApplied = attackBuffs.preAttackDamage;
  if (preAttackDamageApplied > 0) {
    to.unit_count = Math.max(1, to.unit_count - preAttackDamageApplied);
  }

  const result = resolveCombat(
    from.unit_count,
    to.unit_count,
    finalAttackerDiceOverride,
    defenderDiceOverride,
    opts.dieRoll,
    state.era_modifiers,
  );
  // Mirror the socket: surface the dice-bonus breakdowns for client display.
  result.attacker_bonus_breakdown = attackerBonusBreakdown;
  result.defender_bonus_breakdown = defenderBonusBreakdown;

  const base = {
    attackBuffs,
    signatureAttackBonus,
    defenderCharges: defReactions,
    preAttackDamageApplied,
  };
  if (result.error) {
    return {
      result, captured: false, defenderEliminated: false,
      rawAttackerLosses: 0, sourceUnitsAfter: from.unit_count, ...base,
    };
  }

  const rawAttackerLosses = result.attacker_losses;
  if (attackBuffs.negateAttackerLosses) result.attacker_losses = 0;
  from.unit_count -= result.attacker_losses;
  to.unit_count -= result.defender_losses;

  applyDefenderPostCombatReactions({ state, defenderId, fromTerritory: from, toTerritory: to, result });

  // Captured by the socket as `result.source_units_after` (the "Attack again"
  // unit count) — taken after losses, before the capture move-in.
  const sourceUnitsAfter = from.unit_count;

  let defenderEliminated = false;
  if (result.territory_captured) {
    to.owner_id = attackerId;
    to.unit_count = Math.min(from.unit_count - 1, 3);
    from.unit_count = Math.max(1, from.unit_count - to.unit_count);
    onTerritoryCapture(state, toId);
    if (state.settings.stability_enabled) onCaptureStabilityPenalty(state, toId);

    // Keep territory_count current for BOTH involved players — reinforcements
    // (advanceToNextPlayer) and victory checks read it. The socket handler also
    // calls syncTerritoryCounts; only these two players' counts change per attack.
    for (const pid of [attackerId, defenderId]) {
      const pl = state.players.find((p) => p.player_id === pid);
      if (pl) pl.territory_count = Object.values(state.territories).filter((t) => t.owner_id === pid).length;
    }
    const defender = state.players.find((p) => p.player_id === defenderId);
    if (defender && defender.territory_count === 0) {
      defender.is_eliminated = true;
      defenderEliminated = true;
      attacker.cards.push(...defender.cards);
      defender.cards = [];
    }
    opts.onCapture?.(state, attackerId, toId);
  }

  return {
    result, captured: result.territory_captured, defenderEliminated,
    rawAttackerLosses, sourceUnitsAfter, ...base,
  };
}

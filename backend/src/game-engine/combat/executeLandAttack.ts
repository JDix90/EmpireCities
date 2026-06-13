import type { CombatResult, GameState, MapConnection } from '../../types';
import { consumeAttackBuffs } from '../abilities/executeTechAbility';
import { consumeSignatureAttackBonus } from '../eraAdvancement/signatures';
import { onTerritoryCapture } from '../state/economyManager';
import { onCaptureStabilityPenalty } from '../state/stabilityManager';
import { computeLandCombatModifiers } from './combatModifiers';
import { resolveCombat } from './combatResolver';
import { applyDefenderPostCombatReactions, consumeDefenderPreCombatCharges } from './defenderReactions';

export interface ExecuteLandAttackOptions {
  /** Seeded dice for reproducibility; defaults to the engine's CSPRNG. */
  dieRoll?: () => number;
  /** Land connection (used only for sea detection; land-only callers omit it). */
  connection?: MapConnection;
  /** Called once after a successful capture (e.g. to draw a card). */
  onCapture?: (state: GameState, attackerId: string, toId: string) => void;
}

export interface LandAttackOutcome {
  result: CombatResult;
  captured: boolean;
  defenderEliminated: boolean;
}

/**
 * Resolve and apply ONE land combat exchange to game state — the pure-engine
 * extraction of the socket attack handler's land path. It runs the same
 * pipeline (attack buffs + era signature charge, defender pre-combat charges,
 * the full combat modifiers incl. era-gap dice and the vulnerability window,
 * resolveCombat, defender post-combat reactions, capture + stability penalty +
 * elimination) so headless callers (the balance simulator) see combat identical
 * to a real game for the land ruleset.
 *
 * Returns null if the attack is structurally invalid (wrong owner, < 2 units,
 * non-enemy target). Deliberately NOT modeled here (socket-only / out of scope
 * for the land sim): naval crossings, influence, blitzkrieg chains, truce
 * retaliation, daily-puzzle dice, visuals/stat recording, and card draws (pass
 * `onCapture` to add the latter).
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
  if (!to.owner_id || to.owner_id === attackerId) return null;
  if (from.unit_count < 2 || to.unit_count < 1) return null;

  const defenderId = to.owner_id;
  const attackBuffs = consumeAttackBuffs(attacker);
  const signatureAttackBonus = consumeSignatureAttackBonus(attacker);
  const defReactions = consumeDefenderPreCombatCharges(state, defenderId);
  if (defReactions.greekFirePreDamage > 0) {
    from.unit_count = Math.max(1, from.unit_count - defReactions.greekFirePreDamage);
  }

  const { finalAttackerDiceOverride, defenderDiceOverride } = computeLandCombatModifiers({
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
      pending: attackBuffs.extraAttackDie ? 1 : 0,
      era_signature: signatureAttackBonus,
    },
    extraDefenseBonuses: {
      great_wall: defReactions.greatWallDefenseDice,
    },
  });

  // Precision-strike style pre-attack damage (e.g. the Modern era signature).
  if (attackBuffs.preAttackDamage > 0) {
    to.unit_count = Math.max(1, to.unit_count - attackBuffs.preAttackDamage);
  }

  const result = resolveCombat(
    from.unit_count,
    to.unit_count,
    finalAttackerDiceOverride,
    defenderDiceOverride,
    opts.dieRoll,
    state.era_modifiers,
  );
  if (result.error) return { result, captured: false, defenderEliminated: false };

  if (attackBuffs.negateAttackerLosses) result.attacker_losses = 0;
  from.unit_count -= result.attacker_losses;
  to.unit_count -= result.defender_losses;

  applyDefenderPostCombatReactions({ state, defenderId, fromTerritory: from, toTerritory: to, result });

  let defenderEliminated = false;
  if (result.territory_captured) {
    to.owner_id = attackerId;
    to.unit_count = Math.min(from.unit_count - 1, 3);
    from.unit_count = Math.max(1, from.unit_count - to.unit_count);
    onTerritoryCapture(state, toId);
    if (state.settings.stability_enabled) onCaptureStabilityPenalty(state, toId);

    // Keep territory_count current for BOTH involved players — reinforcements
    // (advanceToNextPlayer) and victory checks read it. The socket handler calls
    // syncTerritoryCounts here; only these two players' counts change per attack.
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

  return { result, captured: result.territory_captured, defenderEliminated };
}

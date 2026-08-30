import type { CombatResult, GameState, MapConnection } from '../../types';
import { executeLandAttack } from './executeLandAttack';
import type { LandAttackOutcome } from './executeLandAttack';

/**
 * Server blitz — "attack until captured" as ONE socket event.
 *
 * A human pressing an attack today clicks the same button up to a dozen times,
 * waiting a round-trip and a modal per click, while the AI (aiAttackGrind)
 * presses within its budget automatically. This runs the identical loop for a
 * human in a single event: repeated `executeLandAttack` exchanges until the
 * garrison falls, the attacker can no longer attack, or a defensive hard cap.
 *
 * Deliberate semantics:
 * - LAND ONLY. A sea assault pays its fleet crossing and bombardment per
 *   attack; auto-repeating it would burn a navy on one click. Same exclusion
 *   the AI grind makes.
 * - There is NO material-edge floor here, unlike the AI's grind: a human who
 *   chooses "until captured" is explicitly accepting the attrition. The unit
 *   floor (< 2 attackers) and the capture itself are the only natural stops.
 * - Ownership is re-read from live state between exchanges, never taken from
 *   the returned `captured` flag — a defender reaction can veto a capture
 *   after `resolveCombat` has already reported one.
 *
 * Socket-only per-exchange concerns (one-shot bonuses like truce retaliation,
 * blitzkrieg arming/consuming, March-to-the-Sea chain state) are injected via
 * callbacks so this loop stays engine-pure and unit-testable.
 */

/**
 * Defensive ceiling only. Every exchange removes at least one unit from the
 * combined pool, so any realistic fight decides in far fewer; the cap exists
 * so a pathological state can never wedge the room lock.
 */
export const BLITZ_MAX_EXCHANGES = 64;

export type BlitzStop = 'captured' | 'exhausted' | 'cap' | 'error';

export interface BlitzOutcome {
  /** Aggregated result: total losses, final dice, per-exchange breakdown. */
  result: CombatResult;
  /** Per-exchange outcomes, first to last (socket callers drive visuals/stats). */
  exchanges: LandAttackOutcome[];
  captured: boolean;
  stop: BlitzStop;
}

export interface ExecuteBlitzAttackOptions {
  dieRoll?: () => number;
  connection?: MapConnection;
  neutralOffworldCaptureAllowed?: boolean;
  onCapture?: (state: GameState, attackerId: string, toId: string) => void;
  /** Attacker dice bonuses for a given exchange (0-based). One-shot bonuses belong on index 0. */
  extraAttackBonuses?: (exchangeIndex: number) => Record<string, number> | undefined;
  /** Defender dice bonuses for a given exchange (0-based). */
  extraDefenseBonuses?: (exchangeIndex: number) => Record<string, number> | undefined;
  /** Called after each resolved exchange (blitzkrieg/march bookkeeping). */
  onExchangeResolved?: (outcome: LandAttackOutcome, exchangeIndex: number) => void;
}

/**
 * Returns null when the FIRST exchange is structurally invalid (same contract
 * as `executeLandAttack`); afterwards a failure stops the loop but the
 * exchanges already resolved stand, exactly as manual repeat-attacks would.
 */
export function executeBlitzAttack(
  state: GameState,
  attackerId: string,
  fromId: string,
  toId: string,
  opts: ExecuteBlitzAttackOptions = {},
): BlitzOutcome | null {
  const exchanges: LandAttackOutcome[] = [];
  let stop: BlitzStop = 'cap';

  for (let i = 0; i < BLITZ_MAX_EXCHANGES; i++) {
    const outcome = executeLandAttack(state, attackerId, fromId, toId, {
      dieRoll: opts.dieRoll,
      connection: opts.connection,
      neutralOffworldCaptureAllowed: opts.neutralOffworldCaptureAllowed,
      onCapture: opts.onCapture,
      extraAttackBonuses: opts.extraAttackBonuses?.(i),
      extraDefenseBonuses: opts.extraDefenseBonuses?.(i),
    });
    if (!outcome || outcome.result.error) {
      if (exchanges.length === 0) return null;
      stop = 'error';
      break;
    }
    exchanges.push(outcome);
    opts.onExchangeResolved?.(outcome, i);

    // Live-state reads, per the AI grind's hard-won rules.
    if (state.territories[toId]?.owner_id === attackerId) {
      stop = 'captured';
      break;
    }
    const from = state.territories[fromId];
    if (!from || from.owner_id !== attackerId || from.unit_count < 2) {
      stop = 'exhausted';
      break;
    }
  }

  if (exchanges.length === 0) return null;
  const last = exchanges[exchanges.length - 1];
  const captured = state.territories[toId]?.owner_id === attackerId;

  // Aggregate on top of the LAST exchange's result so the modal's existing
  // fields (dice bonus breakdowns, callouts attached later by the socket)
  // stay coherent, while the headline numbers cover the whole blitz.
  const result: CombatResult = {
    ...last.result,
    attacker_losses: exchanges.reduce((s, e) => s + e.result.attacker_losses, 0),
    defender_losses: exchanges.reduce((s, e) => s + e.result.defender_losses, 0),
    territory_captured: captured,
    source_units_after: last.sourceUnitsAfter,
    blitz_exchanges: exchanges.length,
    blitz_rolls: exchanges.map((e) => ({
      attacker_rolls: e.result.attacker_rolls,
      defender_rolls: e.result.defender_rolls,
      attacker_losses: e.result.attacker_losses,
      defender_losses: e.result.defender_losses,
    })),
  };

  return { result, exchanges, captured, stop };
}

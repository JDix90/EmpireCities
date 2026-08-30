import type { AiDifficulty, GameState } from '../../types';

/**
 * The AI's per-turn attack budget, counted in DICE EXCHANGES rather than in
 * distinct edges attacked.
 *
 * One `executeLandAttack` is exactly one `resolveCombat` exchange. That exchange
 * rolls `min(defendingUnits, 2)` defender dice and compares
 * `min(attackerDice, defenderDice)` pairs, so it removes at most two defenders —
 * while `territory_captured` requires `defenderLosses >= defendingUnits`
 * (combatResolver.ts). The planner emits each (from, to) edge at most once per
 * turn. Composed, those meant the AI could not take a territory holding three or
 * more units: not rarely, never, at every difficulty and on every map. That is
 * what "the AI never attacks me properly" actually was.
 *
 * The numbers below are the previous per-turn attack caps, unchanged. Only their
 * meaning changes: the AI may now spend several of them grinding one edge until
 * it falls, instead of poking several edges once each. Because the total number
 * of exchanges per turn is identical, turn pacing is unchanged too — the socket
 * still sleeps once per exchange.
 */
export const AI_ATTACK_EXCHANGE_BUDGET: Record<AiDifficulty, number> = {
  tutorial: 0,
  easy: 2,
  medium: 4,
  hard: 8,
  expert: 8,
};

export type GrindStop =
  | 'ok'
  | 'budget_spent'
  | 'captured'
  | 'source_drained'
  | 'no_material_edge'
  | 'missing';

/**
 * Should the AI spend another exchange on this same edge?
 *
 * Read against LIVE state between exchanges, never against the previous
 * outcome: a defender reaction can veto a capture after `resolveCombat` has
 * already reported one, so ownership is the only trustworthy signal.
 */
export function shouldContinueGrind(
  state: GameState,
  attackerId: string,
  fromId: string,
  toId: string,
  exchangesLeft: number,
): GrindStop {
  if (exchangesLeft <= 0) return 'budget_spent';

  const from = state.territories[fromId];
  const to = state.territories[toId];
  if (!from || !to) return 'missing';

  if (to.owner_id === attackerId) return 'captured';
  if (from.owner_id !== attackerId) return 'missing';
  if (from.unit_count < 2) return 'source_drained';

  // Never grind a fight we are losing. Without this floor, medium inherits
  // easy's suicide behaviour: it would feed a shrinking stack into a garrison
  // it can no longer take, one exchange at a time, until the source is empty.
  if (from.unit_count <= to.unit_count) return 'no_material_edge';

  return 'ok';
}

/** What one exchange decided about the rest of the turn. */
export type ExchangeSignal =
  /** Exchange landed; keep grinding if the board and budget still allow it. */
  | 'ok'
  /** Something about this edge is done or invalid; move to the next planned action. */
  | 'stop'
  /** The whole AI turn must end now (victory, seat reclaimed). */
  | 'abort_turn';

export interface GrindOutcome {
  exchangesSpent: number;
  stop: GrindStop | 'aborted' | 'exchange_stopped' | 'no_grind';
  aborted: boolean;
}

/**
 * Spend exchanges on ONE edge until it falls, stops being worth grinding, or the
 * turn's budget runs out.
 *
 * The caller owns everything that is once-per-ACTION rather than once-per-
 * exchange — the naval crossing and its bombardment penalty, the truce-break
 * retaliation splice, the faction attack self-buff — and does it before calling
 * this. `exchange` performs one dice exchange and reports back; `budget` is the
 * turn-wide allowance and is mutated so several edges share it.
 *
 * Lives here rather than inline in the socket so the loop is testable: this is
 * the part that decides how hard the AI presses, and the socket's AI turn path
 * has no test harness of its own.
 */
export async function runAiAttackExchanges(opts: {
  state: GameState;
  attackerId: string;
  fromId: string;
  toId: string;
  /** Turn-wide exchange allowance, mutated in place. */
  budget: { left: number };
  /** False for edges that must not be repeated (sea lanes), or when the flag is off. */
  canGrind: boolean;
  exchange: (exchangeIndex: number) => Promise<ExchangeSignal> | ExchangeSignal;
  /** Socket pacing between exchanges. Not called after the final one. */
  betweenExchanges?: () => Promise<void>;
}): Promise<GrindOutcome> {
  let spent = 0;

  for (;;) {
    const signal = await opts.exchange(spent);
    // The budget is charged for every attempt, landed or not: it is the only
    // monotone quantity here, and an uncharged path is an infinite loop.
    spent += 1;
    opts.budget.left -= 1;

    if (signal === 'abort_turn') return { exchangesSpent: spent, stop: 'aborted', aborted: true };
    if (signal === 'stop') return { exchangesSpent: spent, stop: 'exchange_stopped', aborted: false };
    if (!opts.canGrind) return { exchangesSpent: spent, stop: 'no_grind', aborted: false };

    const verdict = shouldContinueGrind(
      opts.state, opts.attackerId, opts.fromId, opts.toId, opts.budget.left,
    );
    if (verdict !== 'ok') return { exchangesSpent: spent, stop: verdict, aborted: false };

    await opts.betweenExchanges?.();
  }
}

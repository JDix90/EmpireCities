import type { GameMap, GameState } from '../../types';
import { computeWinProbabilities } from '../state/gameStateManager';
import { aiProfile, type AiLevel } from './aiProfiles';
import { edgeCaptureOdds } from './aiEdgeOdds';

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
 * Each level's budget is its profile's `exchangeBudget` (ai/aiProfiles.ts):
 * the previous per-turn attack caps, unchanged. Only their meaning changed: the
 * AI may spend several of them grinding one edge until it falls, instead of
 * poking several edges once each. Because the total number of exchanges per
 * turn is identical, turn pacing is unchanged too — the socket still sleeps
 * once per exchange.
 */

/**
 * Decided-game escape (ai_decided_game_press_enabled).
 *
 * The per-turn budget above is tuned for a live game. Once a game is DECIDED —
 * the AI holds a clear majority of the board and the armies — that same budget
 * becomes the reason solo games drag: the winner dribbles a few exchanges a
 * turn while the loser lingers for ten more turns everyone can already call.
 * When the acting AI's heuristic win probability clears the threshold, its
 * budget doubles and the planner lifts its attack cap by FINISHER_OVERCAP, so
 * the game ends instead of decaying.
 *
 * 0.7 of `computeWinProbabilities` — 55% territory share + 45% army share,
 * renormalized over active players — is comfortably past any live game: in a
 * 1v1 it means roughly 70% of the board and the armies combined.
 */
export const DECIDED_GAME_WIN_PROB = 0.7;
export const DECIDED_GAME_BUDGET_MULT = 2;

/**
 * Should this AI spend a decided game pressing to finish it?
 *
 * Easy and tutorial never press (profile.decidedPress): easy's whole contract is
 * being forgiving, and the tutorial AI does not attack at all. The flag check
 * stays with the caller (featureFlags is process-level; this must stay pure for
 * tests and sims).
 */
export function shouldPressDecidedGame(
  state: GameState,
  playerId: string,
  difficulty: AiLevel,
): boolean {
  if (!aiProfile(difficulty).decidedPress) return false;
  return (computeWinProbabilities(state)[playerId] ?? 0) > DECIDED_GAME_WIN_PROB;
}

/** The per-turn exchange budget, with the decided-game press applied. */
export function aiAttackExchangeBudget(difficulty: AiLevel, decidedPress: boolean): number {
  const base = aiProfile(difficulty).exchangeBudget;
  return decidedPress ? base * DECIDED_GAME_BUDGET_MULT : base;
}

export type GrindStop =
  | 'ok'
  | 'budget_spent'
  | 'captured'
  | 'source_drained'
  | 'no_material_edge'
  /** Pressing on the odds: the capture chance fell below the level's continue odds. */
  | 'odds_turned'
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

/**
 * Pressing on the odds (ai_odds_press_enabled).
 *
 * The fixed budget above stops a bot when its 2, 4 or 8 exchanges are spent,
 * however the fight stands: a 20-unit stack facing three defenders gives up
 * because the dice count ran out. Pressing on the odds, the bot starts an
 * attack when its chance of taking the territory, plus what the capture is
 * worth, reaches the level's `pressStartOdds`; rolls again while the chance
 * alone stays at `pressContinueOdds` or better; and stops at the turn's
 * `pressExchangeCeiling` (ai/aiProfiles.ts). The chance is read from the live
 * board before every exchange, so a run that goes badly stops, and one that
 * goes well finishes the job.
 *
 * There is no reserve yet. Keeping back a share of the largest rival stack
 * beside a source cost every level games in the arena: without a model of
 * which rival will attack where, it mostly held units nobody threatened. The
 * threat model planned for Phase 3 is where a reserve belongs.
 */

/** The turn's exchange ceiling when pressing on the odds; the decided-game press doubles it. */
export function aiPressExchangeCeiling(difficulty: AiLevel, decidedPress: boolean): number {
  const base = aiProfile(difficulty).pressExchangeCeiling;
  return decidedPress ? base * DECIDED_GAME_BUDGET_MULT : base;
}

/**
 * Does the bot open an attack on this edge at all? Its capture chance from
 * the live board, plus a third of what the plan said the capture is worth
 * (`pressValue`, on the planner's 3·P − 1 scale), must reach the level's
 * start odds. Rolling again reads the odds alone (shouldContinuePress), so a
 * valuable target is never pressed into a hopeless fight.
 */
export function shouldStartPress(
  state: GameState,
  map: GameMap,
  attackerId: string,
  fromId: string,
  toId: string,
  difficulty: AiLevel,
  pressValue = 0,
): boolean {
  const from = state.territories[fromId];
  if (!from || from.unit_count < 2) return false;
  const odds = edgeCaptureOdds(state, map, attackerId, fromId, toId);
  return odds + pressValue / 3 >= aiProfile(difficulty).pressStartOdds;
}

/**
 * shouldContinueGrind's counterpart when pressing on the odds: the same live
 * reads of ownership and the ceiling, with the level's continue odds in
 * place of the material-edge floor.
 */
export function shouldContinuePress(
  state: GameState,
  map: GameMap,
  attackerId: string,
  fromId: string,
  toId: string,
  exchangesLeft: number,
  difficulty: AiLevel,
): GrindStop {
  if (exchangesLeft <= 0) return 'budget_spent';
  const from = state.territories[fromId];
  const to = state.territories[toId];
  if (!from || !to) return 'missing';
  if (to.owner_id === attackerId) return 'captured';
  if (from.owner_id !== attackerId) return 'missing';
  if (from.unit_count < 2) return 'source_drained';
  if (edgeCaptureOdds(state, map, attackerId, fromId, toId) < aiProfile(difficulty).pressContinueOdds) {
    return 'odds_turned';
  }
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
  /**
   * Whether to roll again, given the exchanges left; shouldContinueGrind's
   * material-edge rule when absent. Pressing on the odds passes
   * shouldContinuePress.
   */
  continueCheck?: (exchangesLeft: number) => GrindStop;
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

    const verdict = opts.continueCheck
      ? opts.continueCheck(opts.budget.left)
      : shouldContinueGrind(opts.state, opts.attackerId, opts.fromId, opts.toId, opts.budget.left);
    if (verdict !== 'ok') return { exchangesSpent: spent, stop: verdict, aborted: false };

    await opts.betweenExchanges?.();
  }
}

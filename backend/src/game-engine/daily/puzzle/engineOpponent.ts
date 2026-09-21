/**
 * The scripted opponent, played through the real engine.
 *
 * opponent.ts expands a plan exactly for the solver; this runs the same plan
 * on a live GameState — the AI's turn in a v2 daily, and the parity test's way
 * of proving the model and the engine agree. Every decision reads the same
 * rule as the model: conditions from the primary objective, assault odds from
 * the model's own dice (so ACW rifle doctrine and Discovery sea caps match),
 * the press floor `keep`, marches up to the era's fortify limit.
 */
import type { GameMap, GameState, MapConnection } from '../../../types';
import { executeLandAttack, type LandAttackOutcome } from '../../combat/executeLandAttack';
import { captureChance } from './dice';
import { AI, HUMAN, assaultRules, type PuzzleContext } from './model';
import type { OpponentPlan, PlanCondition, PlanStep } from './opponent';

function connectionBetween(map: GameMap, a: string, b: string): MapConnection | undefined {
  return map.connections.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function ownerSide(state: GameState, tid: string, humanId: string, aiId: string): number {
  const o = state.territories[tid]?.owner_id;
  return o === humanId ? HUMAN : o === aiId ? AI : 0;
}

function holds(state: GameState, ctx: PuzzleContext, humanId: string, aiId: string, when: PlanCondition | undefined): boolean {
  const w = when ?? 'always';
  const primary = ctx.ids[ctx.objective.targets[0]];
  if (w === 'always') return true;
  if (w === 'objective_human') return ownerSide(state, primary, humanId, aiId) === HUMAN;
  if (w === 'objective_ai') return ownerSide(state, primary, humanId, aiId) === AI;
  if (w === 'objective_attacked') return !!state.puzzle_objective_attacked;
  return state.turn_number === w.turn;
}

export interface ScriptedTurnOptions {
  /** The die; the engine's own when absent (a live v2 daily passes its seeded queue). */
  dieRoll?: () => number;
  /** After the draft lands. */
  onDraft?: (to: string, units: number) => void | Promise<void>;
  /**
   * After each exchange, with the engine's outcome. Return false to end the
   * turn at once (the socket does so when the exchange ended the game).
   */
  onExchange?: (from: string, to: string, outcome: LandAttackOutcome) => boolean | void | Promise<boolean | void>;
  /** After each march. */
  onMarch?: (from: string, to: string, units: number) => void | Promise<void>;
}

/**
 * Play the AI's turn from `state.draft_units_remaining` (already computed by
 * advanceToNextPlayer) through assaults and marches. Mutates `state`. The
 * hooks are for the socket, which broadcasts as the turn unfolds; without
 * them the turn runs straight through (the parity test, the sweep).
 */
export async function runScriptedAiTurn(
  state: GameState,
  map: GameMap,
  ctx: PuzzleContext,
  plan: OpponentPlan,
  humanId: string,
  aiId: string,
  opts: ScriptedTurnOptions = {},
): Promise<void> {
  const owned = () => ctx.ids.filter((id) => state.territories[id]?.owner_id === aiId);
  if (owned().length === 0) {
    state.draft_units_remaining = 0;
    return;
  }

  // Draft.
  state.phase = 'draft';
  const n = state.draft_units_remaining ?? 0;
  let draftTo: string | null = null;
  for (const step of plan.steps) {
    if (step.kind !== 'draft' || !holds(state, ctx, humanId, aiId, step.when)) continue;
    if (state.territories[step.to]?.owner_id !== aiId) continue;
    draftTo = step.to;
    break;
  }
  if (!draftTo) {
    const list = owned();
    draftTo = list.reduce((best, t) => (state.territories[t].unit_count > state.territories[best].unit_count ? t : best), list[0]);
  }
  if (n > 0) state.territories[draftTo].unit_count += n;
  state.draft_units_remaining = 0;
  if (n > 0 && opts.onDraft) await opts.onDraft(draftTo, n);

  // Assaults.
  state.phase = 'attack';
  for (const step of plan.steps) {
    if (step.kind !== 'assault') continue;
    if (!assaultApplies(state, ctx, plan, step, humanId, aiId)) continue;
    const keep = Math.max(1, step.keep ?? 1);
    const connection = connectionBetween(map, step.from, step.to);
    for (let guard = 0; guard < 64; guard++) {
      const from = state.territories[step.from];
      const to = state.territories[step.to];
      if (to.owner_id === aiId) break;
      if (from.unit_count <= keep || from.unit_count < 2) break;
      const outcome = executeLandAttack(state, aiId, step.from, step.to, { dieRoll: opts.dieRoll, connection });
      if (!outcome) break;
      if (opts.onExchange && (await opts.onExchange(step.from, step.to, outcome)) === false) return;
      if (outcome.captured) break;
    }
  }

  // Marches.
  state.phase = 'fortify';
  let left = ctx.fortifyMoves;
  for (const step of plan.steps) {
    if (left <= 0) break;
    if (step.kind !== 'march' || !holds(state, ctx, humanId, aiId, step.when)) continue;
    const from = state.territories[step.from];
    const to = state.territories[step.to];
    if (!from || !to || from.owner_id !== aiId || to.owner_id !== aiId || from.unit_count < 2) continue;
    const avail = from.unit_count - 1;
    const units = step.units ?? 'all_but_1';
    const move = units === 'all_but_1' ? avail : units === 'half' ? Math.floor(avail / 2) : Math.min(avail, units);
    if (move <= 0) continue;
    from.unit_count -= move;
    to.unit_count += move;
    left -= 1;
    if (opts.onMarch) await opts.onMarch(step.from, step.to, move);
  }
}

function assaultApplies(
  state: GameState,
  ctx: PuzzleContext,
  _plan: OpponentPlan,
  step: Extract<PlanStep, { kind: 'assault' }>,
  humanId: string,
  aiId: string,
): boolean {
  if (!holds(state, ctx, humanId, aiId, step.when)) return false;
  const from = state.territories[step.from];
  const to = state.territories[step.to];
  if (!from || !to || from.owner_id !== aiId || to.owner_id !== humanId || from.unit_count < 2) return false;
  const fi = ctx.index.get(step.from);
  const ti = ctx.index.get(step.to);
  if (fi === undefined || ti === undefined) return false;
  return captureChance(from.unit_count, to.unit_count, assaultRules(ctx, fi, ti)) >= (step.min_odds ?? 0);
}

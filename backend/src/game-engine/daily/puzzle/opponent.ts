/**
 * The scripted opponent.
 *
 * A puzzle's opponent is not the live bot but a plan authored on the
 * set-piece: what it drafts onto, what it assaults and when, what it marches
 * where. The plan is deterministic, so the solver can expand the AI's turn
 * exactly (assaults are the only chance), the intent shown to the player is
 * stable, and the plan IS the lesson — what the opponent will do is what the
 * puzzle exists to teach.
 *
 * Conditions are read from the AI's side of the primary objective territory:
 *   always              — every turn
 *   objective_human     — the human holds the objective right now
 *   objective_ai        — the AI holds it
 *   objective_attacked  — the human attacked an objective this round
 *   { turn: n }         — on the AI's n-th turn only
 *
 * Steps run in order: drafts first (the first applicable one takes every
 * reinforcement; with none, the AI's biggest stack does), then assaults, then
 * marches, up to the era's fortify limit. An assault only launches when its
 * odds clear `min_odds` on the board as it stands, and presses until the
 * garrison falls or the stack is down to `keep`.
 */
import { assaultOutcomes, captureChance } from './dice';
import {
  AI,
  HUMAN,
  PENDING,
  FAILED,
  assaultRules,
  cloneState,
  evaluateObjective,
  reinforcements,
  territoriesOf,
  type PuzzleContext,
  type PuzzleState,
} from './model';

export type PlanCondition = 'always' | 'objective_human' | 'objective_ai' | 'objective_attacked' | { turn: number };

export type PlanStep =
  | { kind: 'draft'; to: string; when?: PlanCondition }
  | { kind: 'assault'; from: string; to: string; keep?: number; min_odds?: number; when?: PlanCondition }
  | { kind: 'march'; from: string; to: string; units?: 'all_but_1' | 'half' | number; when?: PlanCondition };

export interface OpponentPlan {
  steps: PlanStep[];
}

type Compiled =
  | { kind: 'draft'; to: number; when: PlanCondition }
  | { kind: 'assault'; from: number; to: number; keep: number; minOdds: number; when: PlanCondition }
  | { kind: 'march'; from: number; to: number; units: 'all_but_1' | 'half' | number; when: PlanCondition };

export interface CompiledPlan {
  steps: Compiled[];
}

export function compilePlan(ctx: PuzzleContext, plan: OpponentPlan): CompiledPlan {
  const idx = (id: string): number => {
    const i = ctx.index.get(id);
    if (i === undefined) throw new Error(`plan names a territory outside the puzzle: ${id}`);
    return i;
  };
  return {
    steps: plan.steps.map((s): Compiled => {
      const when = s.when ?? 'always';
      if (s.kind === 'draft') return { kind: 'draft', to: idx(s.to), when };
      if (s.kind === 'assault') {
        return { kind: 'assault', from: idx(s.from), to: idx(s.to), keep: Math.max(1, s.keep ?? 1), minOdds: s.min_odds ?? 0, when };
      }
      return { kind: 'march', from: idx(s.from), to: idx(s.to), units: s.units ?? 'all_but_1', when };
    }),
  };
}

function holds(ctx: PuzzleContext, s: PuzzleState, when: PlanCondition): boolean {
  const primary = ctx.objective.targets[0];
  if (when === 'always') return true;
  if (when === 'objective_human') return primary !== undefined && s.owner[primary] === HUMAN;
  if (when === 'objective_ai') return primary !== undefined && s.owner[primary] === AI;
  if (when === 'objective_attacked') return s.objectiveAttacked;
  return s.aiTurns === when.turn;
}

export interface Branch {
  state: PuzzleState;
  p: number;
}

/**
 * The AI's whole turn as a distribution over resulting states. The states
 * returned are still on the AI's side: the caller advances play to the human
 * (model.advanceToHuman), which is where the round counter and the timeout
 * live, exactly as advanceToNextPlayer does it.
 */
export function runAiTurn(ctx: PuzzleContext, plan: CompiledPlan, start: PuzzleState): Branch[] {
  const s = cloneState(start);
  s.side = AI;
  s.aiTurns += 1;
  if (s.outcome !== PENDING || territoriesOf(s, AI).length === 0) {
    return [{ state: s, p: 1 }];
  }

  // Draft.
  const n = reinforcements(ctx, s, AI);
  let draftTo = -1;
  for (const step of plan.steps) {
    if (step.kind !== 'draft' || !holds(ctx, s, step.when) || s.owner[step.to] !== AI) continue;
    draftTo = step.to;
    break;
  }
  if (draftTo < 0) {
    const owned = territoriesOf(s, AI);
    draftTo = owned.reduce((best, t) => (s.units[t] > s.units[best] ? t : best), owned[0]);
  }
  s.units[draftTo] += n;

  // Assaults, each expanding every live branch.
  let branches: Branch[] = [{ state: s, p: 1 }];
  for (const step of plan.steps) {
    if (step.kind !== 'assault') continue;
    const next: Branch[] = [];
    for (const b of branches) {
      const st = b.state;
      const launch =
        st.outcome === PENDING
        && holds(ctx, st, step.when)
        && st.owner[step.from] === AI
        && st.owner[step.to] === HUMAN
        && st.units[step.from] >= 2
        && captureChance(st.units[step.from], st.units[step.to], assaultRules(ctx, step.from, step.to)) >= step.minOdds;
      if (!launch) {
        next.push(b);
        continue;
      }
      const rules = assaultRules(ctx, step.from, step.to);
      for (const o of assaultOutcomes(st.units[step.from], st.units[step.to], step.keep, rules)) {
        const ns = cloneState(st);
        ns.units[step.from] = o.fromUnits;
        ns.units[step.to] = o.toUnits;
        if (o.captured) ns.owner[step.to] = AI;
        // The engine evaluates after the AI acts too: a hold day is lost the
        // moment the garrison falls, and an eliminated human is a loss.
        if (territoriesOf(ns, HUMAN).length === 0) ns.outcome = FAILED;
        else evaluateObjective(ctx, ns);
        next.push({ state: ns, p: b.p * o.p });
      }
    }
    branches = mergeBranches(next);
  }

  // Marches (fortify), up to the era's limit.
  for (const b of branches) {
    const st = b.state;
    if (st.outcome !== PENDING) continue;
    let left = ctx.fortifyMoves;
    for (const step of plan.steps) {
      if (left <= 0) break;
      if (step.kind !== 'march' || !holds(ctx, st, step.when)) continue;
      if (st.owner[step.from] !== AI || st.owner[step.to] !== AI || st.units[step.from] < 2) continue;
      const avail = st.units[step.from] - 1;
      const move = step.units === 'all_but_1' ? avail : step.units === 'half' ? Math.floor(avail / 2) : Math.min(avail, step.units);
      if (move <= 0) continue;
      st.units[step.from] -= move;
      st.units[step.to] += move;
      left -= 1;
    }
  }
  return branches;
}

/** Collapse identical states so the expectation is over distinct positions. */
export function mergeBranches(branches: Branch[]): Branch[] {
  const byKey = new Map<string, Branch>();
  for (const b of branches) {
    const k = `${b.state.outcome}|${b.state.owner.join('')}|${b.state.units.join(',')}|${b.state.reachedTurn}`;
    const e = byKey.get(k);
    if (e) e.p += b.p;
    else byKey.set(k, { state: b.state, p: b.p });
  }
  return [...byKey.values()];
}

/**
 * The plan in the player's words, for the intro and the archive.
 *
 * Steps that share a condition are written as one line. A relief plan has two
 * steps under each of two conditions, and spelling the condition out on all
 * four lines read like a form letter rather than a briefing.
 */
export function describePlan(ctx: PuzzleContext, plan: OpponentPlan, name: (id: string) => string): string[] {
  const objective = ctx.objective.targets.map((t) => name(ctx.ids[t])).join(' and ') || 'the objective';
  const lead = (w?: PlanCondition): string => {
    if (!w || w === 'always') return '';
    if (w === 'objective_human') return `Once you take ${objective}`;
    if (w === 'objective_ai') return `While it holds ${objective}`;
    if (w === 'objective_attacked') return `The turn you attack ${objective}`;
    return `On its turn ${w.turn}`;
  };
  const phrase = (s: PlanStep): string => {
    if (s.kind === 'draft') return `reinforces ${name(s.to)}`;
    if (s.kind === 'assault') {
      const odds = s.min_odds ? ` when the odds are ${Math.round(s.min_odds * 100)}% or better` : '';
      return `attacks ${name(s.to)} from ${name(s.from)}${odds}`;
    }
    return `marches ${name(s.from)} into ${name(s.to)}`;
  };

  // Grouped across the whole plan, not just runs of adjacent steps: a chain
  // day alternates its two conditions, so adjacency alone still repeated each
  // lead twice. Conditions are mutually exclusive within a turn and order
  // inside a group is preserved, so this reorders nothing that matters.
  const groups: { when?: PlanCondition; parts: string[] }[] = [];
  const byKey = new Map<string, { when?: PlanCondition; parts: string[] }>();
  for (const step of plan.steps) {
    const key = JSON.stringify(step.when ?? 'always');
    const existing = byKey.get(key);
    if (existing) existing.parts.push(phrase(step));
    else {
      const group = { when: step.when, parts: [phrase(step)] };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups.map((g) => {
    const body = g.parts.length > 1
      ? `${g.parts.slice(0, -1).join(', ')}, then ${g.parts[g.parts.length - 1]}`
      : g.parts[0];
    const head = lead(g.when);
    return head ? `${head}: ${body}.` : `It ${body}.`;
  });
}

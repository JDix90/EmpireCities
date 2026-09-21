/**
 * The human's moves, abstracted to keep the tree small.
 *
 * A player in the real game places reinforcements one at a time, attacks one
 * exchange at a time and fortifies any number of units along any owned path.
 * The solver sees the decisions underneath those clicks:
 *
 *   draft     — all reinforcements onto one frontline territory, or half and
 *               half onto two;
 *   assault   — attack a neighbour until it falls or the stack is down to
 *               `keep` (1 = all in; 3 = stop with a garrison's worth left);
 *   fortify   — move all but one, or half, along an owned path onto a
 *               frontline or objective territory;
 *   end_attack / end_turn.
 *
 * Every rule an action applies mirrors an engine rule (see model.ts). The
 * pruning here (frontline drafts, a cap on assaults per turn, fortify only
 * toward the front) is the search's, not the game's: a player may do other
 * things, and a move outside this set is graded by the sampled fallback, never
 * refused (see the design brief, §5.1).
 *
 * `end_turn` absorbs the opponent's whole reply and the advance back to the
 * human, so every state the solver holds is either terminal or the human's to
 * move. That is what lets the search be a plain maximisation over expectations.
 */
import type { StoredPuzzleAction } from '../dailyPuzzleTypes';
import { assaultOutcomes } from './dice';
import {
  AI,
  HUMAN,
  PENDING,
  PHASE_ATTACK,
  PHASE_DRAFT,
  PHASE_FORTIFY,
  advanceToHuman,
  assaultRules,
  cloneState,
  connectedThrough,
  evaluateObjective,
  frontline,
  territoriesOf,
  type PuzzleContext,
  type PuzzleState,
} from './model';
import { mergeBranches, runAiTurn, type Branch, type CompiledPlan } from './opponent';

export type HumanAction =
  | { kind: 'draft'; to: number; split?: number }
  | { kind: 'assault'; from: number; to: number; keep: number }
  | { kind: 'end_attack' }
  | { kind: 'fortify'; from: number; to: number; units: 'all_but_1' | 'half' }
  | { kind: 'end_turn' };

export interface Puzzle {
  ctx: PuzzleContext;
  plan: CompiledPlan;
}

export function actionKey(a: HumanAction): string {
  switch (a.kind) {
    case 'draft': return `draft:${a.to}${a.split !== undefined ? `+${a.split}` : ''}`;
    case 'assault': return `assault:${a.from}>${a.to}k${a.keep}`;
    case 'end_attack': return 'end_attack';
    case 'fortify': return `fortify:${a.from}>${a.to}:${a.units}`;
    case 'end_turn': return 'end_turn';
  }
}

/**
 * The move as a player sees it: "attack B from A" whether the stop is at one
 * or three, "draft onto X" with or without the split named. Keep variants and
 * split variants of one idea are not two choices, so this is the key the
 * decision test and the near-best count group by.
 */
export function coarseActionKey(a: HumanAction): string {
  switch (a.kind) {
    case 'draft': return `draft:${a.to}${a.split !== undefined ? `+${a.split}` : ''}`;
    case 'assault': return `assault:${a.from}>${a.to}`;
    case 'fortify': return `fortify:${a.from}>${a.to}`;
    case 'end_attack': return 'end_attack';
    case 'end_turn': return 'end_turn';
  }
}

export function describeAction(ctx: PuzzleContext, a: HumanAction, name: (id: string) => string = (id) => id): string {
  const n = (i: number) => name(ctx.ids[i]);
  switch (a.kind) {
    case 'draft':
      return a.split !== undefined ? `Draft half onto ${n(a.to)} and half onto ${n(a.split)}` : `Draft everything onto ${n(a.to)}`;
    case 'assault':
      return a.keep > 1 ? `Attack ${n(a.to)} from ${n(a.from)}, stopping with ${a.keep} left` : `Attack ${n(a.to)} from ${n(a.from)} all in`;
    case 'end_attack':
      return 'Stop attacking';
    case 'fortify':
      return a.units === 'half' ? `Move half of ${n(a.from)} into ${n(a.to)}` : `Move all but one from ${n(a.from)} into ${n(a.to)}`;
    case 'end_turn':
      return 'End turn';
  }
}

/**
 * Where the puzzle is: objective territories, and anything one step from an
 * objective. A move that touches nothing near the objective is not part of the
 * decision the day poses, so the search does not spend nodes on it (and a
 * player who makes one anyway is graded by the fallback, not refused).
 */
function relevant(ctx: PuzzleContext): Set<number> {
  const set = new Set<number>(ctx.objective.targets);
  for (const t of ctx.objective.targets) for (const n of ctx.adj[t]) set.add(n);
  return set;
}

/** Human-owned territories worth reinforcing: objectives held, and stacks that border an unheld objective or an enemy next to one. */
function reinforceSpots(ctx: PuzzleContext, s: PuzzleState): number[] {
  const rel = relevant(ctx);
  const spots = frontline(ctx, s).filter((t) => rel.has(t) || ctx.adj[t].some((n) => s.owner[n] === AI && rel.has(n)));
  return spots.length > 0 ? spots : frontline(ctx, s).length > 0 ? frontline(ctx, s) : territoriesOf(s, HUMAN);
}

/** The action by territory id, for storage and the client. */
export function serializeAction(ctx: PuzzleContext, a: HumanAction): StoredPuzzleAction {
  switch (a.kind) {
    case 'draft': return a.split !== undefined ? { kind: 'draft', to: ctx.ids[a.to], split: ctx.ids[a.split] } : { kind: 'draft', to: ctx.ids[a.to] };
    case 'assault': return { kind: 'assault', from: ctx.ids[a.from], to: ctx.ids[a.to], keep: a.keep };
    case 'fortify': return { kind: 'fortify', from: ctx.ids[a.from], to: ctx.ids[a.to], units: a.units };
    case 'end_attack': return { kind: 'end_attack' };
    case 'end_turn': return { kind: 'end_turn' };
  }
}

/** A stored action back onto the model; null when it names a territory the day does not have. */
export function parseAction(ctx: PuzzleContext, a: StoredPuzzleAction): HumanAction | null {
  const idx = (id: string) => ctx.index.get(id);
  switch (a.kind) {
    case 'draft': {
      const to = idx(a.to);
      const split = a.split !== undefined ? idx(a.split) : undefined;
      if (to === undefined || (a.split !== undefined && split === undefined)) return null;
      return split !== undefined ? { kind: 'draft', to, split } : { kind: 'draft', to };
    }
    case 'assault': {
      const from = idx(a.from);
      const to = idx(a.to);
      if (from === undefined || to === undefined) return null;
      return { kind: 'assault', from, to, keep: Math.max(1, a.keep) };
    }
    case 'fortify': {
      const from = idx(a.from);
      const to = idx(a.to);
      if (from === undefined || to === undefined) return null;
      return { kind: 'fortify', from, to, units: a.units === 'half' ? 'half' : 'all_but_1' };
    }
    case 'end_attack': return { kind: 'end_attack' };
    case 'end_turn': return { kind: 'end_turn' };
    default: return null;
  }
}

export function humanActions(ctx: PuzzleContext, s: PuzzleState): HumanAction[] {
  if (s.outcome !== PENDING || s.side !== HUMAN) return [];
  const out: HumanAction[] = [];

  if (s.phase === PHASE_DRAFT) {
    if (s.draftLeft <= 0) return [{ kind: 'end_attack' }]; // nothing to place: fall through to attack
    const spots = reinforceSpots(ctx, s);
    for (const t of spots) out.push({ kind: 'draft', to: t });
    if (s.draftLeft >= 2 && spots.length <= 4) {
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) out.push({ kind: 'draft', to: spots[i], split: spots[j] });
      }
    }
    return out;
  }

  if (s.phase === PHASE_ATTACK) {
    if (s.assaults < ctx.maxAssaults) {
      const rel = relevant(ctx);
      for (const from of territoriesOf(s, HUMAN)) {
        if (s.units[from] < 2) continue;
        for (const to of ctx.adj[from]) {
          if (s.owner[to] !== AI || !rel.has(to)) continue;
          out.push({ kind: 'assault', from, to, keep: 1 });
          if (s.units[from] >= 5) out.push({ kind: 'assault', from, to, keep: 3 });
        }
      }
    }
    out.push({ kind: 'end_attack' });
    return out;
  }

  // Fortify: toward the objective only.
  if (s.fortifyLeft > 0) {
    const targets = new Set<number>(reinforceSpots(ctx, s));
    for (const from of territoriesOf(s, HUMAN)) {
      if (s.units[from] < 2) continue;
      for (const to of targets) {
        if (to === from || !connectedThrough(ctx, s, HUMAN, from, to)) continue;
        out.push({ kind: 'fortify', from, to, units: 'all_but_1' });
        if (s.units[from] - 1 >= 3) out.push({ kind: 'fortify', from, to, units: 'half' });
      }
    }
  }
  out.push({ kind: 'end_turn' });
  return out;
}

/**
 * Apply a human action. Deterministic actions return one branch; an assault
 * returns its exact outcome distribution; `end_turn` returns the distribution
 * of positions at the start of the human's next turn (or terminal states).
 */
export function applyHumanAction(puzzle: Puzzle, s: PuzzleState, a: HumanAction): Branch[] {
  const { ctx, plan } = puzzle;
  switch (a.kind) {
    case 'draft': {
      const ns = cloneState(s);
      if (a.split !== undefined) {
        const half = Math.floor(ns.draftLeft / 2);
        ns.units[a.to] += half;
        ns.units[a.split] += ns.draftLeft - half;
      } else {
        ns.units[a.to] += ns.draftLeft;
      }
      ns.draftLeft = 0;
      ns.phase = PHASE_ATTACK;
      return [{ state: ns, p: 1 }];
    }
    case 'end_attack': {
      const ns = cloneState(s);
      ns.draftLeft = 0;
      ns.phase = PHASE_FORTIFY;
      return [{ state: ns, p: 1 }];
    }
    case 'assault': {
      const rules = assaultRules(ctx, a.from, a.to);
      const branches: Branch[] = [];
      for (const o of assaultOutcomes(s.units[a.from], s.units[a.to], a.keep, rules)) {
        const ns = cloneState(s);
        ns.units[a.from] = o.fromUnits;
        ns.units[a.to] = o.toUnits;
        if (o.captured) ns.owner[a.to] = HUMAN;
        ns.assaults += 1;
        if (ctx.objective.targets.includes(a.to)) ns.objectiveAttacked = true;
        evaluateObjective(ctx, ns);
        branches.push({ state: ns, p: o.p });
      }
      return mergeBranches(branches);
    }
    case 'fortify': {
      const ns = cloneState(s);
      const avail = ns.units[a.from] - 1;
      const move = a.units === 'all_but_1' ? avail : Math.floor(avail / 2);
      ns.units[a.from] -= move;
      ns.units[a.to] += move;
      ns.fortifyLeft -= 1;
      return [{ state: ns, p: 1 }];
    }
    case 'end_turn': {
      const afterAi = territoriesOf(s, AI).length > 0 ? runAiTurn(ctx, plan, s) : [{ state: cloneState(s), p: 1 }];
      const out: Branch[] = [];
      for (const b of afterAi) {
        advanceToHuman(ctx, b.state);
        out.push(b);
      }
      return mergeBranches(out);
    }
  }
}

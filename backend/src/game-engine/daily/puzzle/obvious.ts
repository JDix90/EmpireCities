/**
 * The obvious line, as a policy over the model.
 *
 * Mirrors puzzleSim's captureLine / holdLine: take the objectives one at a
 * time from the biggest adjacent stack, all in, then mass onto what was taken
 * and wait out the reply; or draft onto the target, bring the reserve in, and
 * never attack. The gate's freebie test asks what this line is worth: a day
 * where it wins is a day the player did not have to think.
 */
import type { HumanAction } from './actions';
import { HUMAN, PHASE_ATTACK, PHASE_DRAFT, territoriesOf, type PuzzleContext, type PuzzleState } from './model';

function biggestHumanNeighbour(ctx: PuzzleContext, s: PuzzleState, t: number): number {
  let best = -1;
  for (const n of ctx.adj[t]) {
    if (s.owner[n] !== HUMAN) continue;
    if (best < 0 || s.units[n] > s.units[best]) best = n;
  }
  return best;
}

/** The next objective not yet held that a human stack can reach. */
function nextObjective(ctx: PuzzleContext, s: PuzzleState): number {
  for (const t of ctx.objective.targets) {
    if (s.owner[t] === HUMAN) continue;
    if (biggestHumanNeighbour(ctx, s, t) >= 0) return t;
  }
  return -1;
}

function thinnestHolding(ctx: PuzzleContext, s: PuzzleState): number {
  let best = -1;
  for (const t of ctx.objective.targets) {
    if (s.owner[t] !== HUMAN) continue;
    if (best < 0 || s.units[t] < s.units[best]) best = t;
  }
  return best;
}

/** A human-owned non-objective neighbour of `t` with units to spare. */
function feederOf(ctx: PuzzleContext, s: PuzzleState, t: number): number {
  for (const n of ctx.adj[t]) {
    if (s.owner[n] === HUMAN && !ctx.objective.targets.includes(n) && s.units[n] >= 2) return n;
  }
  return -1;
}

export function obviousLine(ctx: PuzzleContext, s: PuzzleState): HumanAction {
  if (ctx.objective.kind === 'hold') return holdLine(ctx, s);
  const next = nextObjective(ctx, s);

  if (s.phase === PHASE_DRAFT) {
    if (s.draftLeft <= 0) return { kind: 'end_attack' };
    if (next >= 0) return { kind: 'draft', to: biggestHumanNeighbour(ctx, s, next) };
    const thin = thinnestHolding(ctx, s);
    return { kind: 'draft', to: thin >= 0 ? thin : territoriesOf(s, HUMAN)[0] };
  }

  if (s.phase === PHASE_ATTACK) {
    // One committed assault per turn, from the biggest neighbour, all in.
    if (next >= 0 && s.assaults === 0) {
      const anchor = biggestHumanNeighbour(ctx, s, next);
      if (anchor >= 0 && s.units[anchor] >= 2) return { kind: 'assault', from: anchor, to: next, keep: 1 };
    }
    return { kind: 'end_attack' };
  }

  // Fortify: the objective just taken gets the rest of the stack; otherwise
  // the reserve comes up behind the anchor; with everything held, feed the
  // thinnest holding.
  if (s.fortifyLeft <= 0) return { kind: 'end_turn' };
  const justTaken = ctx.objective.targets.find((t) => s.owner[t] === HUMAN && s.assaults > 0 && biggestHumanNeighbour(ctx, s, t) >= 0 && s.units[t] <= 3);
  if (justTaken !== undefined) {
    const from = biggestHumanNeighbour(ctx, s, justTaken);
    if (from >= 0 && s.units[from] >= 2 && !ctx.objective.targets.includes(from)) return { kind: 'fortify', from, to: justTaken, units: 'all_but_1' };
  }
  if (next >= 0) {
    const anchor = biggestHumanNeighbour(ctx, s, next);
    const reserve = anchor >= 0 ? feederOf(ctx, s, anchor) : -1;
    if (reserve >= 0) return { kind: 'fortify', from: reserve, to: anchor, units: 'all_but_1' };
    return { kind: 'end_turn' };
  }
  const thin = thinnestHolding(ctx, s);
  const feeder = thin >= 0 ? feederOf(ctx, s, thin) : -1;
  if (feeder >= 0) return { kind: 'fortify', from: feeder, to: thin, units: 'all_but_1' };
  return { kind: 'end_turn' };
}

function holdLine(ctx: PuzzleContext, s: PuzzleState): HumanAction {
  const target = ctx.objective.targets[0];
  if (s.phase === PHASE_DRAFT) {
    if (s.draftLeft <= 0) return { kind: 'end_attack' };
    return { kind: 'draft', to: s.owner[target] === HUMAN ? target : territoriesOf(s, HUMAN)[0] };
  }
  if (s.phase === PHASE_ATTACK) return { kind: 'end_attack' };
  if (s.fortifyLeft > 0 && s.owner[target] === HUMAN) {
    const reserve = feederOf(ctx, s, target);
    if (reserve >= 0) return { kind: 'fortify', from: reserve, to: target, units: 'all_but_1' };
  }
  return { kind: 'end_turn' };
}

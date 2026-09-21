/**
 * Solve a daily with the exact puzzle solver and print what the gate reads.
 *
 *   pnpm -C backend exec tsx scripts/solveDaily.ts 2026-09-21
 *   pnpm -C backend exec tsx scripts/solveDaily.ts 2026-09-21 --budget 3000000
 *
 * A date resolves through the schedule exactly as it would be served (v1
 * sizing); the opponent runs the set-piece's authored plan when it has one and
 * an inferred plan otherwise. Prints equity, the obvious line's equity, the
 * gap, the near-best count, the decisions along the best line, the line
 * itself, and the node count — the numbers the design brief's gate is built
 * on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../src/types';
import { scheduleDay } from '../src/game-engine/daily/dailySchedule';
import { contextFromSpec, inferPlan, stateFromSpec, PUZZLE_ARCHETYPES } from '../src/game-engine/daily/puzzle/bridge';
import { compilePlan, describePlan } from '../src/game-engine/daily/puzzle/opponent';
import { analyzePuzzle, BudgetExceeded } from '../src/game-engine/daily/puzzle/solver';
import { obviousLine } from '../src/game-engine/daily/puzzle/obvious';
import { describeAction } from '../src/game-engine/daily/puzzle/actions';
import { territoryDisplayName } from '../src/game-engine/daily/dailyGenerator';

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  if (!mapCache.has(mapId)) {
    mapCache.set(mapId, JSON.parse(readFileSync(join(__dirname, `../../database/maps/${mapId}.json`), 'utf-8')) as GameMap);
  }
  return mapCache.get(mapId)!;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!date) {
    console.error('usage: solveDaily.ts <YYYY-MM-DD> [--budget N] [--turns N]');
    process.exit(2);
  }
  const budgetArg = args.indexOf('--budget');
  const nodeBudget = budgetArg >= 0 ? Number(args[budgetArg + 1]) : undefined;
  // --turns N: solve the day on a shorter clock, the way v2 sizes one.
  const turnsArg = args.indexOf('--turns');
  const turnsOverride = turnsArg >= 0 ? Number(args[turnsArg + 1]) : undefined;

  const day = await scheduleDay(date, { loadMap });
  const spec = day.spec;
  console.log(`${date}  ${day.source}${day.set_piece_id ? ` ${day.set_piece_id}` : ''}  ${spec.archetype}  "${spec.title}"`);
  if (!PUZZLE_ARCHETYPES.has(spec.archetype)) {
    console.log('not a puzzle archetype; nothing to solve');
    return;
  }
  const map = (await loadMap(spec.map_id))!;
  const ctx = contextFromSpec(turnsOverride ? { ...spec, max_turns: turnsOverride } : spec, map);
  const plan = inferPlan(spec, ctx);
  const puzzle = { ctx, plan: compilePlan(ctx, plan) };
  const root = stateFromSpec(ctx, spec);
  const name = (id: string) => territoryDisplayName(map, id);

  console.log(`board: ${ctx.ids.map((id, i) => `${name(id)}=${root.owner[i] === 1 ? 'H' : root.owner[i] === 2 ? 'A' : '-'}${root.units[i]}`).join('  ')}`);
  console.log(`objective: ${ctx.objective.kind} ${ctx.objective.targets.map((t) => name(ctx.ids[t])).join(', ')}  clock ${ctx.maxTurns}  start ${ctx.startingPhase}`);
  console.log('opponent plan:');
  for (const line of describePlan(ctx, plan, name)) console.log(`  - ${line}`);

  const t0 = Date.now();
  try {
    const r = analyzePuzzle(puzzle, root, { policy: obviousLine, nodeBudget });
    const ms = Date.now() - t0;
    const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    console.log(`equity ${pct(r.equity)}  obvious ${pct(r.obviousEquity)}  gap ${r.obviousEquity === null ? 'n/a' : `${((r.equity - r.obviousEquity) * 100).toFixed(1)} pts`}  near-best ${r.nearBest}  decisions ${r.decisions.length}  nodes ${r.nodes}  ${ms} ms`);
    console.log('opening actions:');
    for (const a of r.rootActions.slice(0, 8)) console.log(`  ${pct(a.equity).padStart(6)}  ${describeAction(ctx, a.action, name)}`);
    console.log('decisions on the best line:');
    for (const d of r.decisions) console.log(`  turn ${d.turn}: ${describeAction(ctx, d.best, name)}  (${pct(d.bestEquity)}; the alternative${d.alternative ? ` "${describeAction(ctx, d.alternative, name)}"` : ''} ${pct(d.alternativeEquity)}, gap ${(d.gap * 100).toFixed(1)})`);
    console.log('best line:');
    for (const step of r.line) console.log(`  turn ${step.turn}: ${describeAction(ctx, step.action, name)} → ${pct(step.equity)}${step.followed !== undefined ? ` [followed a ${(step.followed * 100).toFixed(0)}% outcome]` : ''}`);
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      console.log(`budget exceeded after ${err.nodes} nodes in ${Date.now() - t0} ms — raise --budget or narrow the board`);
      return;
    }
    throw err;
  }
}

void main();

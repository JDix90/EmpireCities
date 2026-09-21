/**
 * Sweep the v2 daily schedule over a horizon and print what the gate did.
 *
 *   pnpm -C backend exec tsx scripts/sweepDailyV2.ts 2026-09-21 28
 *
 * For every date: the pick (set-piece, reading, tier), each attempt's verdict,
 * and for an accepted day its equity, the obvious line's, the near-best count,
 * the decisions and the node count. The last line totals the horizon. This is
 * the measurement behind the sweep test's horizon and the gate's constants.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../src/types';
import { describeAttempts, pickSetPieceForDateV2, proveV2Day } from '../src/game-engine/daily/dailyScheduleV2';
import { contextFromSpec } from '../src/game-engine/daily/puzzle/bridge';
import { describeAction } from '../src/game-engine/daily/puzzle/actions';
import { territoryDisplayName } from '../src/game-engine/daily/dailyGenerator';

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  if (!mapCache.has(mapId)) {
    mapCache.set(mapId, JSON.parse(readFileSync(join(__dirname, `../../database/maps/${mapId}.json`), 'utf-8')) as GameMap);
  }
  return mapCache.get(mapId)!;
}

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function main(): Promise<void> {
  const [start = '2026-09-21', daysArg = '28'] = process.argv.slice(2);
  const days = Number(daysArg);
  let eligible = 0;
  let accepted = 0;
  let totalMs = 0;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const date of datesFrom(start, days)) {
    const pick = pickSetPieceForDateV2(date);
    if (!pick) {
      console.log(`${date}  v1 (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T00:00:00Z`).getUTCDay()]})`);
      continue;
    }
    eligible += 1;
    const t0 = Date.now();
    const { proven, attempts } = await proveV2Day(date, pick, { loadMap, simulate: null });
    const ms = Date.now() - t0;
    totalMs += ms;
    const head = `${date}  ${pick.set_piece.id} (${pick.verb}, ${pick.tier.decisions} decisions, clock ${pick.tier.clock})`;
    if (!proven) {
      console.log(`${head}  FAILED in ${ms} ms`);
      for (const line of describeAttempts(attempts)) console.log(`    ${line}`);
      continue;
    }
    accepted += 1;
    const { spec, analysis } = proven;
    const map = (await loadMap(spec.map_id))!;
    const ctx = contextFromSpec(spec, map);
    const name = (id: string) => territoryDisplayName(map, id);
    console.log(
      `${head}  OK attempt ${attempts.length - 1}  equity ${pct(analysis.equity)}  obvious ${pct(analysis.obviousEquity ?? analysis.equity)}  `
        + `near ${spec.v2?.solution.near_best}  decisions ${analysis.decisions.length}  nodes ${analysis.nodes}  ${ms} ms  theme "${spec.v2?.theme}"`,
    );
    for (const line of describeAttempts(attempts.slice(0, -1))) console.log(`    ${line}`);
    for (const d of analysis.decisions) {
      console.log(`    turn ${d.turn}: ${describeAction(ctx, d.best, name)} ${pct(d.bestEquity)} vs ${d.alternative ? `"${describeAction(ctx, d.alternative, name)}"` : 'nothing'} ${pct(d.alternativeEquity)}`);
    }
  }
  console.log(`\n${accepted}/${eligible} eligible days accepted over ${days} days; ${(totalMs / 1000).toFixed(0)} s solving`);
}

void main();

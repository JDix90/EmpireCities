import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import { DAILY_CALENDAR } from '../../content/dailyCalendar';
import { plannedSetPieces } from '../../content/dailySetPiecePlans';
import { pickSetPieceForDate, scheduleDay, verbForDate, weekdayOf } from './dailySchedule';
import {
  describeAttempts,
  HOLD_RESERVE_BONUS,
  judgeAnalysis,
  pickSetPieceForDateV2,
  proveV2Day,
  scheduleDayV2,
  tierForDate,
  V2_GATE,
  V2_TIERS,
} from './dailyScheduleV2';
import { validateDailyPuzzleSpec } from './dailyPuzzleService';
import { contextFromSpec, stateFromSpec } from './puzzle/bridge';
import { parseAction } from './puzzle/actions';
import { compilePlan } from './puzzle/opponent';
import { obviousLine } from './puzzle/obvious';
import { Solver } from './puzzle/solver';

/**
 * The review board for the v2 days. The v2 schedule is a pure function of the
 * date, so the sweep below is not a sample: every date in the horizon that
 * proves as v2 is the puzzle that will be served under the flag, checked
 * against the gate it was proven by, the persistence validator, and the play
 * path's ability to read its solution back onto the board.
 */

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
  mapCache.set(mapId, doc);
  return doc;
}
const deps = { loadMap, simulate: null };

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
const DAY = 86_400_000;
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

describe('daily schedule v2 — tiers', () => {
  it('Monday to Wednesday and Saturday are two-decision days with verdicts before the dice', () => {
    for (const wd of [1, 2, 3, 6]) {
      expect(V2_TIERS[wd]).toEqual({ decisions: 2, clock: 3, verdicts: 'before_dice', intent: 'arrows' });
    }
  });

  it('Friday is the three-decision day: prose only, verdicts held until the end', () => {
    expect(V2_TIERS[5]).toEqual({ decisions: 3, clock: 4, verdicts: 'silent', intent: 'prose' });
  });

  it('Thursday and Sunday keep their v1 form', () => {
    expect(V2_TIERS[4]).toBeNull();
    expect(V2_TIERS[0]).toBeNull();
    expect(tierForDate('2026-09-24')).toBeNull(); // Thu
    expect(tierForDate('2026-09-27')).toBeNull(); // Sun
    expect(tierForDate('2026-09-25')?.decisions).toBe(3); // Fri
  });
});

describe('daily schedule v2 — which set-piece a date gets', () => {
  it('a dated calendar entry is never read as v2', () => {
    for (const date of Object.keys(DAILY_CALENDAR)) expect(pickSetPieceForDateV2(date), date).toBeNull();
  });

  it('Thursday and Sunday are never read as v2', () => {
    for (const date of datesFrom('2026-09-14', 56)) {
      const wd = weekdayOf(date);
      if (wd === 4 || wd === 0) expect(pickSetPieceForDateV2(date), date).toBeNull();
    }
  });

  it('a day whose set-piece carries no plan stays v1', () => {
    const planned = new Set([...plannedSetPieces('tactical'), ...plannedSetPieces('region'), ...plannedSetPieces('chain'), ...plannedSetPieces('hold')].map((sp) => sp.id));
    for (const date of datesFrom('2026-09-14', 56)) {
      const wd = weekdayOf(date);
      if (wd === 2 || wd === 4 || wd === 0) continue;
      const v1 = pickSetPieceForDate(date);
      const v2 = pickSetPieceForDateV2(date);
      if (!v1 || !planned.has(v1.id)) expect(v2, date).toBeNull();
      else if (v2) expect(v2.set_piece.id, date).toBe(v1.id);
    }
  });

  it('Wednesday is the hold reading with the hold plan; Friday region and chain days carry their capture plans', () => {
    for (const date of datesFrom('2026-09-14', 56)) {
      const pick = pickSetPieceForDateV2(date);
      if (!pick) continue;
      const wd = weekdayOf(date);
      if (wd === 3) {
        expect(pick.verb, date).toBe('hold');
        expect(pick.set_piece.kind).toBe('tactical');
      } else {
        expect(pick.verb, date).not.toBe('hold');
        expect(pick.verb, date).toBe(pick.set_piece.kind);
      }
      if (wd === 5) expect(pick.tier.decisions).toBe(3);
      else expect(pick.tier.decisions).toBe(2);
    }
  });

  it('Tuesday serves a planned capture or chain that the v1 cadence does not serve within six days either side, nor the previous Tuesday', () => {
    let tuesdays = 0;
    let previous: string | null = null;
    for (const date of datesFrom('2026-09-14', 91)) {
      if (weekdayOf(date) !== 2) continue;
      const pick = pickSetPieceForDateV2(date);
      if (!pick) continue;
      tuesdays += 1;
      expect(pick.set_piece.id, `${date} repeats the previous Tuesday`).not.toBe(previous);
      previous = pick.set_piece.id;
      expect(['tactical', 'chain'], date).toContain(pick.set_piece.kind);
      expect(verbForDate(date)).toBe('economy'); // the v1 reading of the same date
      for (let d = -6; d <= 6; d++) {
        if (d === 0) continue;
        expect(pickSetPieceForDate(addDays(date, d))?.id, `${date} ${d >= 0 ? '+' : ''}${d}`).not.toBe(pick.set_piece.id);
      }
    }
    expect(tuesdays).toBeGreaterThan(0);
  });

  it('is a pure function of the date', () => {
    for (const date of datesFrom('2026-09-21', 14)) {
      expect(pickSetPieceForDateV2(date)).toEqual(pickSetPieceForDateV2(date));
    }
  });
});

// Every v2-eligible day in the horizon is proven here. Days that fail the
// gate are reported, not failed: the library migrates set-piece by set-piece
// and a day the gate refuses is served as v1, which is the design. What must
// hold is that every accepted day is exactly what the gate says it is.
const HORIZON = [...datesFrom('2026-09-21', 14)];

interface ProvenDay {
  date: string;
  pick: NonNullable<ReturnType<typeof pickSetPieceForDateV2>>;
  result: Awaited<ReturnType<typeof proveV2Day>>;
}

describe('daily schedule v2 — the sweep', { timeout: 900_000 }, () => {
  let days: ProvenDay[] = [];
  let ready: Promise<void> = Promise.resolve();
  // In a hook, not at collection: the solve is CPU-bound and must not run
  // when this block is filtered out.
  beforeAll(() => {
    ready = (async () => {
      days = [];
      for (const date of HORIZON) {
        const pick = pickSetPieceForDateV2(date);
        if (!pick) continue;
        const result = await proveV2Day(date, pick, deps);
        days.push({ date, pick, result });
      }
    })();
    return ready;
  }, 900_000);

  const accepted = () => days.filter((d) => d.result.proven !== null);

  it('proves a real share of the eligible days (the rest are served as v1)', async () => {
    await ready;
    for (const d of days) {
      console.log(`${d.date} ${d.pick.set_piece.id} (${d.pick.verb}): ${d.result.proven ? 'v2' : 'v1'} — ${describeAttempts(d.result.attempts).join(' | ')}`);
    }
    expect(days.length).toBeGreaterThan(0);
    expect(accepted().length, 'accepted days').toBeGreaterThanOrEqual(Math.ceil(days.length / 2));
  });

  it('every accepted day satisfies the gate it was proven by', async () => {
    await ready;
    for (const { date, pick, result } of accepted()) {
      const { spec, analysis } = result.proven!;
      const verdict = judgeAnalysis(analysis, pick.tier);
      expect(verdict.ok, `${date}: ${verdict.reasons.join('; ')}`).toBe(true);
      expect(analysis.equity).toBeGreaterThanOrEqual(V2_GATE.minEquity);
      expect(analysis.equity - (analysis.obviousEquity ?? 1)).toBeGreaterThanOrEqual(V2_GATE.minGap);
      expect(spec.v2!.solution.near_best).toBeLessThanOrEqual(V2_GATE.maxNearBest);
      expect(spec.v2!.solution.decisions.length).toBeGreaterThanOrEqual(pick.tier.decisions);
      expect(spec.v2!.solution.decisions.length).toBeLessThanOrEqual(pick.tier.decisions + 1);
      expect(spec.v2!.solution.nodes).toBeLessThanOrEqual(V2_GATE.nodeBudget);
    }
  });

  it('carries the tier and the plan on the spec', async () => {
    await ready;
    for (const { date, pick, result } of accepted()) {
      const { spec } = result.proven!;
      expect(spec.v2, date).toBeDefined();
      expect(spec.v2!.version).toBe(2);
      expect(spec.v2!.theme).toBe(pick.plan.theme);
      expect(spec.v2!.plan).toEqual(pick.plan.plan);
      // One line per condition, not per step: steps sharing a condition are
      // written together, so the prose is never longer than the plan.
      expect(spec.v2!.plan_prose.length).toBeGreaterThan(0);
      expect(spec.v2!.plan_prose.length).toBeLessThanOrEqual(pick.plan.plan.steps.length);
      expect(spec.v2!.decisions_target).toBe(pick.tier.decisions);
      expect(spec.v2!.verdicts).toBe(pick.tier.verdicts);
      expect(spec.v2!.intent).toBe(pick.tier.intent);
      expect(spec.max_turns).toBe(pick.tier.clock);
      if (spec.archetype === 'hold_territory') {
        expect(spec.goal).toContain(`for ${pick.tier.clock} turns`);
        expect(spec.par_turns).toBeUndefined();
      } else {
        expect(spec.par_turns).toBeGreaterThanOrEqual(1);
        expect(spec.par_turns).toBeLessThanOrEqual(pick.tier.clock);
      }
    }
  });

  it('deals the hold reading its stronger reserve', async () => {
    await ready;
    // v1's calibrateHold deals the reserve 3–5; the v2 reading adds the bonus.
    let holds = 0;
    for (const { date, pick, result } of accepted()) {
      if (pick.verb !== 'hold' || pick.set_piece.kind !== 'tactical' || !pick.set_piece.relief) continue;
      holds += 1;
      const reserve = result.proven!.spec.starting_board![pick.set_piece.relief];
      expect(reserve.owner, date).toBe('human');
      expect(reserve.unit_count, date).toBeGreaterThanOrEqual(3 + HOLD_RESERVE_BONUS);
      expect(reserve.unit_count, date).toBeLessThanOrEqual(5 + HOLD_RESERVE_BONUS);
    }
    expect(holds).toBeGreaterThan(0);
  });

  it('passes the persistence validator, including after a JSONB round-trip', async () => {
    await ready;
    for (const { date, result } of accepted()) {
      const { spec } = result.proven!;
      expect(validateDailyPuzzleSpec(spec), date).not.toBeNull();
      expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify(spec))), date).not.toBeNull();
      expect(validateDailyPuzzleSpec({ ...spec, v2: { ...spec.v2, version: 3 } }), date).toBeNull();
    }
  });

  it('stores a solution the play path can read back onto the board', async () => {
    await ready;
    for (const { date, result } of accepted()) {
      const { spec } = result.proven!;
      const map = (await loadMap(spec.map_id))!;
      const ctx = contextFromSpec(spec, map);
      const puzzle = { ctx, plan: compilePlan(ctx, spec.v2!.plan) };
      for (const d of spec.v2!.solution.decisions) {
        expect(parseAction(ctx, d.best), `${date} decision best`).not.toBeNull();
        if (d.alternative) expect(parseAction(ctx, d.alternative), `${date} decision alternative`).not.toBeNull();
        expect(d.gap).toBeGreaterThanOrEqual(V2_GATE.decisionGap - 1e-4);
      }
      for (const step of spec.v2!.solution.line) expect(parseAction(ctx, step.action), `${date} line`).not.toBeNull();
      // The stored opening equity is the solver's, from a fresh solve of the stored spec.
      const fresh = new Solver(puzzle, V2_GATE.nodeBudget);
      const root = stateFromSpec(ctx, spec);
      expect(fresh.value(root)).toBeCloseTo(spec.v2!.solution.equity, 3);
      expect(fresh.policyValue(root, obviousLine)).toBeCloseTo(spec.v2!.solution.obvious_equity, 3);
    }
  });

  it('is deterministic: the schedule computes the identical day with fresh state', async () => {
    await ready;
    for (const { date, result } of accepted().slice(0, 2)) {
      const again = await scheduleDayV2(date, { loadMap: async (id) => loadMap(id), simulate: null });
      expect(again).not.toBeNull();
      expect(again!.spec).toEqual(result.proven!.spec);
      expect(again!.set_piece_id).toBe(result.proven!.spec.v2 ? days.find((d) => d.date === date)!.pick.set_piece.id : undefined);
    }
  });

  it('leaves the v1 day of the same date untouched', async () => {
    await ready;
    for (const { date } of accepted().slice(0, 3)) {
      const v1 = await scheduleDay(date, deps);
      expect(v1.spec.v2).toBeUndefined();
    }
  });
});

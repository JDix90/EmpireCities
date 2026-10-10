/**
 * The v2 bench (scripts/benchDailyV2.ts): what each date of a horizon is
 * served as, and how the dates that are proven fare at the gate. Pure: the
 * script proves the days, this file reads the dates and adds up what came
 * back, so the tallies are testable without a solve.
 */
import { getAuthoredDailySpec } from '../../content/dailyCalendar';
import { planFor } from '../../content/dailySetPiecePlans';
import { pickSetPieceForDate, verbForDate, weekdayOf, type DailyVerb } from './dailySchedule';
import { candidateForDateV2, tierForDate, type GateCause, type V2Attempt } from './dailyScheduleV2';

/**
 * What a date is served as, before any solve:
 * - calendar: a dated calendar entry, authored and always v1;
 * - v1_weekday: Thursday or Sunday, which keep their v1 form;
 * - not_gradeable: a reading with no dice decision to grade (economy, tech);
 * - no_plan: a fight whose reading has no opponent's plan yet;
 * - planned: a fight with its plan, which the gate proves or refuses.
 */
export type DateClass = 'calendar' | 'v1_weekday' | 'not_gradeable' | 'no_plan' | 'planned';

export interface ClassifiedDate {
  date: string;
  class: DateClass;
  /** The set-piece the date serves: the v2 candidate on a fight, the v1 pick otherwise. Null on a calendar day. */
  set_piece_id: string | null;
  /** How that set-piece is read on the date. Null on a calendar day. */
  verb: DailyVerb | null;
}

export function classifyDate(date: string): ClassifiedDate {
  if (getAuthoredDailySpec(date)) return { date, class: 'calendar', set_piece_id: null, verb: null };
  const candidate = candidateForDateV2(date);
  if (candidate) {
    const planned = planFor(candidate.set_piece, candidate.verb === 'hold') !== null;
    return { date, class: planned ? 'planned' : 'no_plan', set_piece_id: candidate.set_piece.id, verb: candidate.verb };
  }
  const v1 = pickSetPieceForDate(date);
  const slot = verbForDate(date);
  const verb = v1 ? (slot === 'any' ? (v1.kind as DailyVerb) : slot) : null;
  return { date, class: tierForDate(date) ? 'not_gradeable' : 'v1_weekday', set_piece_id: v1?.id ?? null, verb };
}

/** One planned date proven, as the bench's workers send it back: plain data, so it crosses a process boundary. */
export interface DateProof {
  date: string;
  set_piece_id: string;
  verb: DailyVerb;
  /** The decisions the date's tier asks for. */
  decisions: number;
  ok: boolean;
  attempts: V2Attempt[];
  ms: number;
  /** The best line's decisions in words, on an accepted day. */
  detail?: string[];
}

/**
 * Why an attempt missed: a gate cause, the search running out of budget (an
 * attempt with no verdict), or no attempt at all because the day could not
 * be sized.
 */
export type BenchCause = GateCause | 'budget' | 'unsized';

/** Report order: the causes that keep a reading off the gate entirely come first. */
export const BENCH_CAUSES: readonly BenchCause[] = ['decision_count', 'no_key_move', 'budget', 'too_hard', 'obvious_close', 'unsized'];

export function attemptCauses(attempt: V2Attempt): BenchCause[] {
  return attempt.verdict ? attempt.verdict.causes : ['budget'];
}

/** A failed day's causes: those some attempt missed on, and those every attempt missed on. */
export function dayCauses(attempts: readonly V2Attempt[]): { any: Set<BenchCause>; every: Set<BenchCause> } {
  if (attempts.length === 0) return { any: new Set(['unsized']), every: new Set(['unsized']) };
  const perAttempt = attempts.map((a) => new Set(attemptCauses(a)));
  const any = new Set(perAttempt.flatMap((causes) => [...causes]));
  const every = new Set([...any].filter((c) => perAttempt.every((causes) => causes.has(c))));
  return { any, every };
}

export type CauseTally = Partial<Record<BenchCause, { any: number; every: number }>>;

/** How many failed days each cause appeared on, in some attempt and in every attempt. */
export function tallyCauses(proofs: readonly DateProof[]): CauseTally {
  const tally: CauseTally = {};
  for (const proof of proofs) {
    if (proof.ok) continue;
    const { any, every } = dayCauses(proof.attempts);
    for (const c of any) {
      const row = (tally[c] ??= { any: 0, every: 0 });
      row.any += 1;
      if (every.has(c)) row.every += 1;
    }
  }
  return tally;
}

export interface ReadingTally {
  set_piece_id: string;
  verb: DailyVerb;
  served: number;
  passed: number;
  causes: CauseTally;
}

/** Pass rates per set-piece and reading, worst first: lowest pass rate, then the most days served. */
export function tallyReadings(proofs: readonly DateProof[]): ReadingTally[] {
  const groups = new Map<string, DateProof[]>();
  for (const proof of proofs) {
    const key = `${proof.set_piece_id}\u0000${proof.verb}`;
    const group = groups.get(key);
    if (group) group.push(proof);
    else groups.set(key, [proof]);
  }
  const rows: ReadingTally[] = [...groups.values()].map((group) => ({
    set_piece_id: group[0].set_piece_id,
    verb: group[0].verb,
    served: group.length,
    passed: group.filter((p) => p.ok).length,
    causes: tallyCauses(group),
  }));
  return rows.sort((a, b) =>
    a.passed / a.served - b.passed / b.served
    || b.served - a.served
    || a.set_piece_id.localeCompare(b.set_piece_id)
    || a.verb.localeCompare(b.verb));
}

/** Proven days and passes per UTC weekday (0 = Sunday), weekdays with no proven day left out. */
export function tallyWeekdays(proofs: readonly DateProof[]): Array<{ weekday: number; served: number; passed: number }> {
  const rows = new Map<number, { weekday: number; served: number; passed: number }>();
  for (const proof of proofs) {
    const weekday = weekdayOf(proof.date);
    const row = rows.get(weekday) ?? { weekday, served: 0, passed: 0 };
    row.served += 1;
    if (proof.ok) row.passed += 1;
    rows.set(weekday, row);
  }
  // Monday first, Sunday last: the order the week is played in.
  return [...rows.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
}

export interface Coverage {
  days: number;
  calendar: number;
  v1_weekday: number;
  not_gradeable: number;
  no_plan: number;
  /** Planned dates the gate accepted: graded days. */
  graded: number;
  /** Planned dates the gate refused, served as v1. */
  gate_failed: number;
  /** Planned dates with no proof supplied. Zero after a full run. */
  unproven: number;
}

/** What a horizon is served as, from its classified dates and the proofs of its planned ones. */
export function summarizeCoverage(dates: readonly ClassifiedDate[], proofs: readonly DateProof[]): Coverage {
  const byDate = new Map(proofs.map((p) => [p.date, p]));
  const out: Coverage = { days: dates.length, calendar: 0, v1_weekday: 0, not_gradeable: 0, no_plan: 0, graded: 0, gate_failed: 0, unproven: 0 };
  for (const d of dates) {
    if (d.class !== 'planned') {
      out[d.class] += 1;
      continue;
    }
    const proof = byDate.get(d.date);
    if (!proof) out.unproven += 1;
    else if (proof.ok) out.graded += 1;
    else out.gate_failed += 1;
  }
  return out;
}

/** The fights served with no plan for their reading, most days first: what writing a plan would grade. */
export function unplannedReadings(dates: readonly ClassifiedDate[]): Array<{ set_piece_id: string; verb: DailyVerb; days: number }> {
  const counts = new Map<string, { set_piece_id: string; verb: DailyVerb; days: number }>();
  for (const d of dates) {
    if (d.class !== 'no_plan' || !d.set_piece_id || !d.verb) continue;
    const key = `${d.set_piece_id}\u0000${d.verb}`;
    const row = counts.get(key) ?? { set_piece_id: d.set_piece_id, verb: d.verb, days: 0 };
    row.days += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.days - a.days || a.set_piece_id.localeCompare(b.set_piece_id) || a.verb.localeCompare(b.verb));
}

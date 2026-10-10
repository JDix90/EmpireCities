import { describe, it, expect } from 'vitest';
import { DAILY_CALENDAR } from '../../content/dailyCalendar';
import {
  classifyDate,
  dayCauses,
  summarizeCoverage,
  tallyCauses,
  tallyReadings,
  tallyWeekdays,
  unplannedReadings,
  type ClassifiedDate,
  type DateProof,
} from './dailyBench';
import { weekdayOf } from './dailySchedule';
import { candidateForDateV2, pickSetPieceForDateV2, type GateCause, type V2Attempt } from './dailyScheduleV2';

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const missed = (attempt: number, ...causes: GateCause[]): V2Attempt => ({
  attempt,
  verdict: { ok: false, reasons: causes.map(String), causes, shift: 0 },
});
const accepted = (attempt: number): V2Attempt => ({ attempt, verdict: { ok: true, reasons: [], causes: [], shift: 0 } });
const outOfBudget = (attempt: number): V2Attempt => ({ attempt, verdict: null, nodes: 600_001 });

function proof(date: string, set_piece_id: string, ok: boolean, attempts: V2Attempt[], verb: DateProof['verb'] = 'tactical'): DateProof {
  return { date, set_piece_id, verb, decisions: 2, ok, attempts, ms: 10 };
}

describe('daily bench — what a date is served as', () => {
  it('agrees with the schedule on every date of a season', () => {
    const seen = new Set<string>();
    for (const date of datesFrom('2026-09-14', 120)) {
      const c = classifyDate(date);
      seen.add(c.class);
      const pick = pickSetPieceForDateV2(date);
      const candidate = candidateForDateV2(date);
      const wd = weekdayOf(date);
      if (date in DAILY_CALENDAR) expect(c.class, date).toBe('calendar');
      else if (wd === 4 || wd === 0) expect(c.class, date).toBe('v1_weekday');
      else if (pick) {
        expect(c, date).toEqual({ date, class: 'planned', set_piece_id: pick.set_piece.id, verb: pick.verb });
      } else if (candidate) {
        expect(c, date).toEqual({ date, class: 'no_plan', set_piece_id: candidate.set_piece.id, verb: candidate.verb });
      } else {
        expect(c.class, date).toBe('not_gradeable');
        expect(['tactical', 'hold', 'region', 'chain'], date).not.toContain(c.verb);
      }
    }
    // The season covers the shapes a horizon is made of.
    for (const cls of ['v1_weekday', 'planned']) expect(seen, cls).toContain(cls);
  });

  it('a dated calendar entry is a calendar day', () => {
    for (const date of Object.keys(DAILY_CALENDAR)) {
      expect(classifyDate(date), date).toEqual({ date, class: 'calendar', set_piece_id: null, verb: null });
    }
  });
});

describe('daily bench — why a day failed', () => {
  it('reads a cause every attempt missed on apart from one that only some did', () => {
    const { any, every } = dayCauses([missed(0, 'too_hard', 'decision_count'), missed(1, 'decision_count'), missed(2, 'no_key_move', 'decision_count')]);
    expect([...any].sort()).toEqual(['decision_count', 'no_key_move', 'too_hard']);
    expect([...every]).toEqual(['decision_count']);
  });

  it('counts a solve that ran out of budget as its own cause', () => {
    expect(dayCauses([outOfBudget(0)])).toEqual({ any: new Set(['budget']), every: new Set(['budget']) });
    const late = dayCauses([missed(0, 'obvious_close'), outOfBudget(1)]);
    expect([...late.any].sort()).toEqual(['budget', 'obvious_close']);
    expect(late.every.size).toBe(0);
  });

  it('reads a day with no attempt as unsized', () => {
    expect(dayCauses([])).toEqual({ any: new Set(['unsized']), every: new Set(['unsized']) });
  });

  it('tallies failed days, not attempts, and leaves accepted days out', () => {
    const tally = tallyCauses([
      proof('2026-10-12', 'a', false, [missed(0, 'decision_count'), missed(1, 'decision_count', 'too_hard')]),
      proof('2026-10-19', 'a', false, [missed(0, 'too_hard')]),
      proof('2026-10-26', 'a', true, [missed(0, 'decision_count'), accepted(1)]),
    ]);
    expect(tally).toEqual({ decision_count: { any: 1, every: 1 }, too_hard: { any: 2, every: 1 } });
  });
});

describe('daily bench — tallies', () => {
  const proofs = [
    proof('2026-10-12', 'good', true, [accepted(0)]),
    proof('2026-10-19', 'good', true, [accepted(0)]),
    proof('2026-10-14', 'good', false, [missed(0, 'obvious_close')], 'hold'),
    proof('2026-10-16', 'bad', false, [outOfBudget(0)], 'region'),
    proof('2026-10-23', 'bad', false, [outOfBudget(0)], 'region'),
    proof('2026-10-17', 'half', true, [accepted(0)], 'chain'),
    proof('2026-10-24', 'half', false, [missed(0, 'no_key_move')], 'chain'),
  ];

  it('rates each set-piece per reading, worst first and the most served first among equals', () => {
    expect(tallyReadings(proofs).map((r) => [r.set_piece_id, r.verb, r.passed, r.served])).toEqual([
      ['bad', 'region', 0, 2],
      ['good', 'hold', 0, 1],
      ['half', 'chain', 1, 2],
      ['good', 'tactical', 2, 2],
    ]);
    expect(tallyReadings(proofs)[0].causes).toEqual({ budget: { any: 2, every: 2 } });
  });

  it('counts each weekday in the order the week is played', () => {
    expect(tallyWeekdays(proofs)).toEqual([
      { weekday: 1, served: 2, passed: 2 },
      { weekday: 3, served: 1, passed: 0 },
      { weekday: 5, served: 2, passed: 0 },
      { weekday: 6, served: 2, passed: 1 },
    ]);
  });

  it('sums a horizon from its classes and its proofs', () => {
    const dates: ClassifiedDate[] = [
      { date: '2026-10-12', class: 'planned', set_piece_id: 'good', verb: 'tactical' },
      { date: '2026-10-16', class: 'planned', set_piece_id: 'bad', verb: 'region' },
      { date: '2026-10-30', class: 'planned', set_piece_id: 'bad', verb: 'region' },
      { date: '2026-10-13', class: 'no_plan', set_piece_id: 'x', verb: 'tactical' },
      { date: '2026-10-15', class: 'v1_weekday', set_piece_id: 'y', verb: 'tech' },
      { date: '2026-10-17', class: 'not_gradeable', set_piece_id: 'z', verb: 'economy' },
      { date: '2026-08-31', class: 'calendar', set_piece_id: null, verb: null },
    ];
    expect(summarizeCoverage(dates, proofs)).toEqual({
      days: 7, calendar: 1, v1_weekday: 1, not_gradeable: 1, no_plan: 1, graded: 1, gate_failed: 1, unproven: 1,
    });
  });

  it('lists the unplanned readings by the days a plan would grade', () => {
    const dates: ClassifiedDate[] = [
      { date: '2026-10-12', class: 'no_plan', set_piece_id: 'b', verb: 'tactical' },
      { date: '2026-10-14', class: 'no_plan', set_piece_id: 'b', verb: 'hold' },
      { date: '2026-10-19', class: 'no_plan', set_piece_id: 'a', verb: 'tactical' },
      { date: '2026-10-26', class: 'no_plan', set_piece_id: 'a', verb: 'tactical' },
      { date: '2026-10-28', class: 'planned', set_piece_id: 'c', verb: 'hold' },
    ];
    expect(unplannedReadings(dates)).toEqual([
      { set_piece_id: 'a', verb: 'tactical', days: 2 },
      { set_piece_id: 'b', verb: 'hold', days: 1 },
      { set_piece_id: 'b', verb: 'tactical', days: 1 },
    ]);
  });
});

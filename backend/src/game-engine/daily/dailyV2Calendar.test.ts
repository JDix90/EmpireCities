import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import { DAILY_SET_PIECES, type DailySetPiece } from '../../content/dailySetPieces';
import { DAILY_V2_CALENDAR } from '../../content/dailyV2Calendar';
import { calendarFingerprint } from './dailyBench';
import { calendarVerdict, pickSetPieceForDateV2, scheduleDayV2, type V2Calendar } from './dailyScheduleV2';

/**
 * The v2 calendar (src/content/dailyV2Calendar.ts) is a cache of a pure
 * function: what the full proof finds for each planned date. These checks
 * keep it honest without proving every date: it was generated from today's
 * inputs, it names exactly the dates and set-pieces the schedule picks, and
 * the schedule only trusts an entry that agrees with its own pick. The sweep
 * in dailyScheduleV2.test.ts proves the first fortnight against it.
 */

const readMap = (mapId: string): string => readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8');
const REGENERATE = 'pnpm -C backend exec tsx scripts/benchDailyV2.ts --all --from 2026-09-21 --days 467 --write-calendar';

function* datesBetween(from: string, to: string): Generator<string> {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

function setPiece(id: string): DailySetPiece {
  const sp = DAILY_SET_PIECES.find((s) => s.id === id);
  if (!sp) throw new Error(`no set-piece ${id}`);
  return sp;
}

describe('daily v2 calendar — the checked-in file', () => {
  it('was proven from the current set-pieces, plans, gate and maps', () => {
    expect(
      calendarFingerprint(readMap),
      `The inputs changed since the calendar was written. Regenerate it: ${REGENERATE}`,
    ).toBe(DAILY_V2_CALENDAR.fingerprint);
  });

  it('names every planned date in its range, with the set-piece and reading the schedule picks', () => {
    let planned = 0;
    for (const date of datesBetween(DAILY_V2_CALENDAR.from, DAILY_V2_CALENDAR.to)) {
      const pick = pickSetPieceForDateV2(date);
      const entry = DAILY_V2_CALENDAR.days[date];
      if (!pick) {
        expect(entry, `${date} has no plan but the calendar lists it`).toBeUndefined();
        continue;
      }
      planned += 1;
      expect(entry, `${date} is planned but missing from the calendar. Regenerate it: ${REGENERATE}`).toBeDefined();
      expect([entry.set_piece_id, entry.verb], date).toEqual([pick.set_piece.id, pick.verb]);
    }
    expect(Object.keys(DAILY_V2_CALENDAR.days)).toHaveLength(planned);
  });

  it('covers the sweep horizon and holds both readings of a day: graded and refused', () => {
    expect(DAILY_V2_CALENDAR.from <= '2026-09-21').toBe(true);
    const entries = Object.values(DAILY_V2_CALENDAR.days);
    expect(entries.some((e) => 'refused' in e)).toBe(true);
    expect(entries.some((e) => !('refused' in e))).toBe(true);
    for (const e of entries) {
      if ('refused' in e) continue;
      expect(Number.isInteger(e.attempt) && e.attempt >= 0).toBe(true);
      expect(Number.isFinite(e.shift)).toBe(true);
    }
  });

  it('ignores wording: a changed intro keeps the fingerprint, a changed board does not', () => {
    const sp = DAILY_SET_PIECES.find((s) => s.kind === 'tactical') as Extract<DailySetPiece, { kind: 'tactical' }>;
    const base = calendarFingerprint(readMap);
    const mutable = sp as { intro: string; anchor: string };
    const { intro, anchor } = mutable;
    try {
      mutable.intro = `${intro} (reworded)`;
      expect(calendarFingerprint(readMap)).toBe(base);
      mutable.anchor = `${anchor}_moved`;
      expect(calendarFingerprint(readMap)).not.toBe(base);
    } finally {
      mutable.intro = intro;
      mutable.anchor = anchor;
    }
    expect(calendarFingerprint(readMap)).toBe(base);
  });
});

describe('daily v2 calendar — what the schedule takes from it', () => {
  const sp = setPiece('the_bulge');
  const calendar: V2Calendar = {
    from: '2026-10-01',
    to: '2026-10-31',
    fingerprint: 'test',
    days: {
      '2026-10-05': { set_piece_id: 'the_bulge', verb: 'tactical', attempt: 2, shift: -0.14 },
      '2026-10-06': { set_piece_id: 'the_bulge', verb: 'tactical', refused: true },
    },
  };

  it('the landing of an accepted date, and refused for a refused one', () => {
    expect(calendarVerdict('2026-10-05', { set_piece: sp, verb: 'tactical' }, calendar)).toEqual({ attempt: 2, shift: -0.14 });
    expect(calendarVerdict('2026-10-06', { set_piece: sp, verb: 'tactical' }, calendar)).toBe('refused');
  });

  it('nothing, so the day is proven in full, outside its range or when the entry is missing or names another pick', () => {
    expect(calendarVerdict('2026-09-30', { set_piece: sp, verb: 'tactical' }, calendar)).toBeNull();
    expect(calendarVerdict('2026-11-01', { set_piece: sp, verb: 'tactical' }, calendar)).toBeNull();
    expect(calendarVerdict('2026-10-07', { set_piece: sp, verb: 'tactical' }, calendar)).toBeNull();
    expect(calendarVerdict('2026-10-05', { set_piece: sp, verb: 'hold' }, calendar)).toBeNull();
    expect(calendarVerdict('2026-10-05', { set_piece: setPiece('checkpoint'), verb: 'tactical' }, calendar)).toBeNull();
  });

  it('serves a refused date as v1 without loading a map or solving', async () => {
    const refused = Object.entries(DAILY_V2_CALENDAR.days).find(([date, e]) => 'refused' in e && pickSetPieceForDateV2(date));
    expect(refused, 'the calendar has a refused date').toBeDefined();
    let loads = 0;
    const deps = {
      loadMap: async (mapId: string): Promise<GameMap | null> => {
        loads += 1;
        return JSON.parse(readMap(mapId)) as GameMap;
      },
      simulate: null,
    };
    expect(await scheduleDayV2(refused![0], deps)).toBeNull();
    expect(loads).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import {
  mondayOf,
  rotationOrdinal,
  scheduleDay,
  WEEKDAY_CADENCE,
  weekdayOf,
  weekIndexOf,
  type ScheduledDay,
} from './dailySchedule';
import { DAILY_SET_PIECES, setPiecesOfKind } from '../../content/dailySetPieces';
import { DAILY_CALENDAR } from '../../content/dailyCalendar';
import { validateDailyPuzzleSpec } from './dailyPuzzleService';
import { captureProbability } from '../combat/combatOdds';
import { getEraTechTree } from '../eras';
import { DEFAULT_BUILDING_COSTS } from '../state/economyManager';
import { goldPerTurn, TACTICAL_BAND_HARD, TACTICAL_BAND_STANDARD, techPerTurn } from './dailyGenerator';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

/**
 * The review board for the days players actually get.
 *
 * The schedule is a pure function of the date, so this sweep is not a sample:
 * every day in the horizon is the day that will be served, checked against the
 * same invariants the authored calendar is held to. Replacing "play each day
 * before it ships" with this file is the point of the design.
 */

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(
    readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8'),
  ) as GameMap;
  mapCache.set(mapId, doc);
  return doc;
}
const deps = { loadMap };

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// A full year after the dated calendar ends.
const SWEEP = [...datesFrom('2026-09-14', 365)];

const VERB_TO_ARCHETYPE = {
  tactical: 'military_capture',
  economy: 'economy_build',
  tech: 'tech_research',
  domination: 'domination',
} as const;

/** First-assault odds the way the calendar test measures them. */
function primaryAssaultOdds(map: GameMap, spec: DailyPuzzleSpec): number {
  const target = spec.target_territory_id!;
  const board = spec.starting_board!;
  let bestStack = 0;
  let bestConnType = 'land';
  for (const conn of map.connections) {
    for (const [a, b] of [[conn.from, conn.to], [conn.to, conn.from]] as const) {
      if (b !== target) continue;
      const holder = board[a];
      if (holder?.owner !== 'human') continue;
      if (holder.unit_count > bestStack) {
        bestStack = holder.unit_count;
        bestConnType = conn.type;
      }
    }
  }
  expect(bestStack, `${spec.title}: no human border force`).toBeGreaterThan(0);
  return captureProbability(bestStack, board[target].unit_count, {
    attackerBaseCap: bestConnType === 'sea' ? 2 : 3,
  });
}

function humanTerritories(spec: DailyPuzzleSpec): number {
  return Object.values(spec.starting_board ?? {}).filter((t) => t.owner === 'human').length;
}

describe('daily schedule — calendar arithmetic', () => {
  it('knows its weekdays and week boundaries', () => {
    expect(weekdayOf('2026-09-14')).toBe(1); // Monday
    expect(weekdayOf('2026-09-20')).toBe(0); // Sunday
    expect(weekIndexOf('2026-09-20')).toBe(weekIndexOf('2026-09-14'));
    expect(weekIndexOf('2026-09-21')).toBe(weekIndexOf('2026-09-14') + 1);
    expect(mondayOf('2026-09-20')).toBe('2026-09-14');
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
    expect(mondayOf('2026-09-19')).toBe('2026-09-14');
  });

  it('walks each verb’s bucket one slot at a time, in calendar order', () => {
    // Mon, Wed, Fri are the three tactical slots of a week.
    const mon = rotationOrdinal('2026-09-14', 'tactical');
    expect(rotationOrdinal('2026-09-16', 'tactical')).toBe(mon + 1);
    expect(rotationOrdinal('2026-09-18', 'tactical')).toBe(mon + 2);
    expect(rotationOrdinal('2026-09-21', 'tactical')).toBe(mon + 3);
    // A weekday that does not carry the verb has no ordinal.
    expect(rotationOrdinal('2026-09-15', 'tactical')).toBe(-1);
    expect(rotationOrdinal('2026-09-15', 'economy')).toBeGreaterThanOrEqual(0);
  });
});

describe('daily schedule — the sweep', () => {
  let days: ScheduledDay[] = [];
  const ready = (async () => {
    days = [];
    for (const date of SWEEP) days.push(await scheduleDay(date, deps));
  })();

  it('every day materializes from the library, never from the last-resort generator', async () => {
    await ready;
    expect(days).toHaveLength(SWEEP.length);
    for (const day of days) {
      expect(day.source, `${day.date} fell through to ${day.source}`).toBe('library');
      expect(day.set_piece_id, day.date).toBeDefined();
    }
  });

  it('follows the weekday cadence', async () => {
    await ready;
    for (const day of days) {
      const slot = WEEKDAY_CADENCE[weekdayOf(day.date)];
      if (slot.verb === 'any') continue;
      expect(day.spec.archetype, day.date).toBe(VERB_TO_ARCHETYPE[slot.verb]);
    }
  });

  it('every spec passes the persistence validator, including after a JSONB round-trip', async () => {
    await ready;
    for (const { date, spec } of days) {
      expect(validateDailyPuzzleSpec(spec), date).not.toBeNull();
      expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify(spec))), date).not.toBeNull();
      expect(spec.player_count, date).toBe(2);
      expect(spec.ai_difficulty, date).toBeDefined();
    }
  });

  it('is deterministic: the same date computes the identical day with fresh state', async () => {
    await ready;
    for (const day of days.slice(0, 21)) {
      const again = await scheduleDay(day.date, { loadMap });
      expect(again).toEqual(day);
    }
  });

  it('tactical days: honest first-assault odds, tight clock, attack-phase open', async () => {
    await ready;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'military_capture') continue;
      const map = (await loadMap(spec.map_id))!;
      const board = spec.starting_board!;
      expect(spec.clear_board, date).toBe(true);
      expect(spec.starting_phase, date).toBe('attack');
      expect(board[spec.target_territory_id!]?.owner, date).toBe('ai');
      expect(board[spec.anchor_territory_id!]?.owner, date).toBe('human');
      expect(spec.max_turns, date).toBeGreaterThanOrEqual(6);
      expect(spec.max_turns, date).toBeLessThanOrEqual(12);

      const band = WEEKDAY_CADENCE[weekdayOf(date)].band === 'hard' ? TACTICAL_BAND_HARD : TACTICAL_BAND_STANDARD;
      const p = primaryAssaultOdds(map, spec);
      expect(p, `${date}: P=${p.toFixed(3)} below the ${band.min} floor`).toBeGreaterThanOrEqual(band.min);
      expect(p, `${date}: P=${p.toFixed(3)} is a freebie`).toBeLessThanOrEqual(0.97);
    }
  });

  it('Friday is the harder fight', async () => {
    await ready;
    const odds = async (filter: (d: ScheduledDay) => boolean) => {
      const ps: number[] = [];
      for (const d of days.filter(filter)) {
        if (d.spec.archetype !== 'military_capture') continue;
        ps.push(primaryAssaultOdds((await loadMap(d.spec.map_id))!, d.spec));
      }
      return ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    const friday = await odds((d) => weekdayOf(d.date) === 5);
    const monday = await odds((d) => weekdayOf(d.date) === 1);
    expect(friday).toBeLessThan(monday);
  });

  it('economy days leave a shortfall the player has to earn, and time to earn it', async () => {
    await ready;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'economy_build') continue;
      expect(spec.clear_board, date).toBe(true);
      const cost = DEFAULT_BUILDING_COSTS[spec.building_type!];
      const grant = spec.grants?.gold ?? 0;
      const perTurn = goldPerTurn(humanTerritories(spec));
      expect(grant, `${date}: grant ${grant} covers the cost ${cost} — a freebie`).toBeLessThan(cost);
      expect(grant + perTurn * (spec.max_turns - 1), `${date}: unreachable`).toBeGreaterThanOrEqual(cost);
    }
  });

  it('tech days name a real node, leave a shortfall, pin the bootstrap off, and give time to earn it', async () => {
    await ready;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'tech_research') continue;
      expect(spec.clear_board, date).toBe(true);
      const node = getEraTechTree(spec.era_id).find((n) => n.tech_id === spec.tech_id);
      expect(node, `${date}: ${spec.tech_id} not in the ${spec.era_id} tree`).toBeDefined();
      expect(spec.settings_overrides?.economy_tech_starting_tech_points, date).toBe(0);
      const grant = spec.grants?.tech_points ?? 0;
      const perTurn = techPerTurn(humanTerritories(spec));
      expect(grant, `${date}: grant ${grant} covers the cost ${node!.cost} — a freebie`).toBeLessThan(node!.cost);
      expect(grant + perTurn * (spec.max_turns - 1), `${date}: unreachable`).toBeGreaterThanOrEqual(node!.cost);
    }
  });

  it('domination days only ever come from the library, and only on Sunday', async () => {
    await ready;
    for (const day of days) {
      if (day.spec.archetype !== 'domination') continue;
      expect(weekdayOf(day.date), day.date).toBe(0);
      expect(setPiecesOfKind('domination').some((sp) => sp.id === day.set_piece_id), day.date).toBe(true);
    }
  });

  it('uses every set-piece in a bucket before repeating any', async () => {
    await ready;
    for (const verb of ['tactical', 'economy', 'tech', 'domination'] as const) {
      const bucket = setPiecesOfKind(verb);
      const used: string[] = [];
      for (const d of days) {
        const slot = WEEKDAY_CADENCE[weekdayOf(d.date)];
        if (slot.verb !== verb) continue;
        used.push(d.set_piece_id!);
        if (used.length === bucket.length) break;
      }
      expect(new Set(used).size, `${verb}: repeats before the bucket is exhausted`).toBe(bucket.length);
    }
  });

  it('a recurring set-piece is a new fight, not a repeat', async () => {
    await ready;
    const byId = new Map<string, ScheduledDay[]>();
    for (const d of days) {
      const list = byId.get(d.set_piece_id!) ?? [];
      list.push(d);
      byId.set(d.set_piece_id!, list);
    }
    let recurrences = 0;
    for (const list of byId.values()) {
      if (list.length < 2) continue;
      recurrences += 1;
      const [a, b] = list;
      expect(a.spec.dice_queue_seed, a.set_piece_id).not.toBe(b.spec.dice_queue_seed);
      // The dealt board is a domination day's content; every other kind is re-sized.
      if (a.spec.archetype !== 'domination') expect(a.spec.seed, a.set_piece_id).not.toBe(b.spec.seed);
    }
    expect(recurrences).toBeGreaterThan(0);
  });

  it('Saturday walks every puzzle set-piece, so each one eventually lands there too', async () => {
    await ready;
    const saturdays = new Set(days.filter((d) => weekdayOf(d.date) === 6).map((d) => d.set_piece_id));
    for (const sp of DAILY_SET_PIECES) {
      if (sp.kind === 'domination') continue;
      expect(saturdays.has(sp.id), `${sp.id} never lands on a Saturday in a year`).toBe(true);
    }
  });

  it('never serves the same set-piece twice in one week', async () => {
    await ready;
    const byWeek = new Map<string, string[]>();
    for (const d of days) {
      const key = mondayOf(d.date);
      byWeek.set(key, [...(byWeek.get(key) ?? []), d.set_piece_id!]);
    }
    for (const [monday, ids] of byWeek) {
      expect(new Set(ids).size, `week of ${monday}: ${ids.join(', ')}`).toBe(ids.length);
    }
  });
});

describe('daily schedule — precedence', () => {
  it('a dated calendar entry wins over the cadence', async () => {
    const date = Object.keys(DAILY_CALENDAR).sort()[0];
    const day = await scheduleDay(date, deps);
    expect(day.source).toBe('calendar');
    expect(day.spec).toEqual(DAILY_CALENDAR[date]);
  });
});

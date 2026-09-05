import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import {
  bucketForVerb,
  GATE_BANDS,
  GATE_GAMES,
  mondayOf,
  rotationOrdinal,
  scheduleDay,
  verbForDate,
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
import { buildingGoalCost, goldPerTurn, techGoalCost, techPerTurn } from './dailyGenerator';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { simulatePuzzle } from './puzzleSim';

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
  hold: 'hold_territory',
  region: 'control_region',
  chain: 'capture_chain',
  economy: 'economy_build',
  tech: 'tech_research',
  domination: 'domination',
} as const;

const CAPTURE_SHAPED = new Set(['military_capture', 'control_region', 'capture_chain']);

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

  it('cycles Friday through a hard capture, a region and a chain', () => {
    const fridays = [...datesFrom('2026-09-18', 21)].filter((d) => weekdayOf(d) === 5);
    expect(fridays.map(verbForDate).sort()).toEqual(['chain', 'region', 'tactical']);
    expect(verbForDate('2026-09-14')).toBe('tactical');
    expect(verbForDate('2026-09-16')).toBe('hold');
    expect(verbForDate('2026-09-20')).toBe('domination');
  });

  it('the ordinal is the count of that verb’s slots before the date, verified against a brute-force count', () => {
    // The closed form has to agree with simply counting, across a cycled slot.
    const dates = [...datesFrom('2026-09-14', 120)];
    for (const verb of ['tactical', 'region', 'chain', 'hold', 'economy'] as const) {
      const first = dates.find((d) => verbForDate(d) === verb)!;
      const base = rotationOrdinal(first, verb);
      let seen = 0;
      for (const d of dates) {
        if (verbForDate(d) !== verb) {
          expect(rotationOrdinal(d, verb), `${d} does not carry ${verb}`).toBe(-1);
          continue;
        }
        expect(rotationOrdinal(d, verb), `${d} ${verb}`).toBe(base + seen);
        seen += 1;
      }
    }
  });
});

describe('daily schedule — the sweep', { timeout: 120_000 }, () => {
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
      const verb = verbForDate(day.date);
      if (verb === 'any') continue;
      expect(day.spec.archetype, day.date).toBe(VERB_TO_ARCHETYPE[verb]);
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

      // The first-assault odds are a sanity range now, not the criterion: the
      // gate shifts the sizing band to land the simulated solve rate, so a
      // freebie front is sized below the standard band on purpose. The
      // calendar's own honest range (0.35–0.97) is the outer bound.
      const p = primaryAssaultOdds(map, spec);
      expect(p, `${date}: P=${p.toFixed(3)} is a coin flip`).toBeGreaterThanOrEqual(0.5);
      expect(p, `${date}: P=${p.toFixed(3)} is a freebie`).toBeLessThanOrEqual(0.97);
    }
  });

  it('hold days: the human holds the target, the AI stack borders it, the odds are a real threat, and there is a reserve', async () => {
    await ready;
    let seen = 0;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'hold_territory') continue;
      seen += 1;
      const map = (await loadMap(spec.map_id))!;
      const board = spec.starting_board!;
      const target = spec.target_territory_id!;
      const anchor = spec.anchor_territory_id!;
      expect(spec.clear_board, date).toBe(true);
      expect(spec.starting_phase, `${date}: a hold day opens in draft so the player can reinforce first`).toBeUndefined();
      expect(board[target]?.owner, date).toBe('human');
      expect(board[anchor]?.owner, date).toBe('ai');
      expect(map.connections.some((c) => (c.from === anchor && c.to === target) || (c.from === target && c.to === anchor)), date).toBe(true);
      expect(spec.max_turns, date).toBeGreaterThanOrEqual(5);
      expect(spec.max_turns, date).toBeLessThanOrEqual(8);
      expect(spec.goal, date).toMatch(/^Hold .+ for \d+ turns\.$/);
      // A reserve the player can fortify into the target.
      const reserve = Object.entries(board).find(([tid, t]) => t.owner === 'human' && tid !== target);
      expect(reserve, `${date}: no human reserve`).toBeDefined();
      expect(map.connections.some((c) => (c.from === reserve![0] && c.to === target) || (c.from === target && c.to === reserve![0])), `${date}: reserve must border the target`).toBe(true);
      // A real threat against garrison + opening draft, but not overwhelming.
      // A sanity range: the simulated solve rate is the criterion, and the
      // gate lowers the stack on purpose when the obvious defence cannot hold.
      const sea = map.connections.some((c) => ((c.from === anchor && c.to === target) || (c.from === target && c.to === anchor)) && c.type === 'sea');
      const p = captureProbability(board[anchor].unit_count, board[target].unit_count + 3, { attackerBaseCap: sea ? 2 : 3 });
      expect(p, `${date}: P(AI captures)=${p.toFixed(3)}`).toBeGreaterThanOrEqual(0.4);
      expect(p, `${date}: P(AI captures)=${p.toFixed(3)}`).toBeLessThanOrEqual(0.92);
    }
    expect(seen).toBeGreaterThan(40);
  });

  it('every served capture and hold day is proven by the simulator: never unwinnable, rarely a freebie', async () => {
    await ready;
    let simulated = 0;
    let outOfBand = 0;
    for (const { date, spec } of days) {
      if (!CAPTURE_SHAPED.has(spec.archetype) && spec.archetype !== 'hold_territory') continue;
      simulated += 1;
      const band = GATE_BANDS[spec.archetype as keyof typeof GATE_BANDS];
      const r = (await simulatePuzzle(spec, (await loadMap(spec.map_id))!, { games: GATE_GAMES }))!;
      // The floor is absolute: an unwinnable board is never served.
      expect(r.solve_rate, `${date} ${spec.title}: ${(r.solve_rate * 100).toFixed(0)}% solvable`).toBeGreaterThanOrEqual(band.min);
      if (r.solve_rate > band.max) outOfBand += 1;
      if (CAPTURE_SHAPED.has(spec.archetype)) {
        expect(spec.par_turns, `${date}: capture day without par`).toBe(r.median_turns);
        // Capture-and-hold: the objective has to survive the enemy's reply,
        // so no capture-shaped day is solved on turn one.
        expect(spec.par_turns, `${date}: par 1 means the capture never had to be held`).toBeGreaterThanOrEqual(2);
      } else {
        expect(spec.par_turns, `${date}: a hold day carries no par`).toBeUndefined();
        expect(spec.ai_difficulty, `${date}: hold days are always medium`).toBe('medium');
      }
    }
    expect(simulated).toBeGreaterThan(150);
    // The ceiling is best-effort: when no attempt lands, the closest above the floor is served.
    expect(outOfBand / simulated, `${outOfBand} of ${simulated} served above the band`).toBeLessThanOrEqual(0.05);
  });

  it('region days: the human holds most of the region, every AI garrison is reachable, and the goal names the region', async () => {
    await ready;
    let seen = 0;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'control_region') continue;
      seen += 1;
      const map = (await loadMap(spec.map_id))!;
      const board = spec.starting_board!;
      const regionIds = map.territories.filter((t) => t.region_id === spec.region_id).map((t) => t.territory_id);
      expect(regionIds.length, date).toBeGreaterThan(0);
      const aiInRegion = regionIds.filter((t) => board[t]?.owner === 'ai');
      const humanInRegion = regionIds.filter((t) => board[t]?.owner === 'human');
      expect(aiInRegion.length, date).toBeGreaterThan(0);
      expect(humanInRegion.length, date).toBeGreaterThanOrEqual(aiInRegion.length);
      for (const g of aiInRegion) {
        const reachable = Object.entries(board).some(([tid, t]) => t.owner === 'human' && map.connections.some((c) => (c.from === tid && c.to === g) || (c.from === g && c.to === tid)));
        expect(reachable, `${date}: garrison ${g} borders no human territory`).toBe(true);
      }
      expect(spec.goal, date).toMatch(/^Control all of .+ and hold it through the enemy’s turn\.$/);
      expect(spec.starting_phase, date).toBe('attack');
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('chain days: each target borders the one before it, the anchor carries the march, and the goal names them all', async () => {
    await ready;
    let seen = 0;
    for (const { date, spec } of days) {
      if (spec.archetype !== 'capture_chain') continue;
      seen += 1;
      const map = (await loadMap(spec.map_id))!;
      const board = spec.starting_board!;
      const targets = spec.target_territory_ids!;
      expect(targets.length, date).toBeGreaterThanOrEqual(2);
      const borders = (a: string, b: string) => map.connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
      expect(borders(spec.anchor_territory_id!, targets[0]), date).toBe(true);
      for (let i = 1; i < targets.length; i++) expect(borders(targets[i - 1], targets[i]), `${date}: ${targets[i]} does not border ${targets[i - 1]}`).toBe(true);
      for (const t of targets) expect(board[t]?.owner, date).toBe('ai');
      expect(board[spec.anchor_territory_id!]?.owner, date).toBe('human');
      const garrisons = targets.reduce((n, t) => n + board[t].unit_count, 0);
      expect(board[spec.anchor_territory_id!].unit_count, `${date}: the stack cannot carry the march`).toBeGreaterThan(garrisons);
      expect(spec.goal, date).toMatch(/^Capture .+ and .+ and hold them through the enemy’s turn\.$/);
    }
    expect(seen).toBeGreaterThan(10);
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
      // A tier-two goal costs the tier beneath it too.
      const cost = buildingGoalCost(spec.building_type!);
      expect(cost).toBeGreaterThanOrEqual(DEFAULT_BUILDING_COSTS[spec.building_type!]);
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
      const cost = techGoalCost(spec.era_id, spec.tech_id!)!;
      expect(cost).toBeGreaterThanOrEqual(node!.cost);
      expect(grant, `${date}: grant ${grant} covers the cost ${cost} — a freebie`).toBeLessThan(cost);
      expect(grant + perTurn * (spec.max_turns - 1), `${date}: unreachable`).toBeGreaterThanOrEqual(cost);
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

  it('every hold-capable front is served as a hold day within the year', async () => {
    await ready;
    const holds = new Set(days.filter((d) => d.spec.archetype === 'hold_territory').map((d) => d.set_piece_id));
    for (const sp of bucketForVerb('hold')) {
      expect(holds.has(sp.id), `${sp.id} never comes round as a hold day`).toBe(true);
    }
  });

  it('uses every set-piece in a bucket before repeating any', async () => {
    await ready;
    // The cursor-walked slots (hold, Saturday) defer an entry rather than
    // repeat one, so this order property is for the plain ordinal walks.
    for (const verb of ['tactical', 'region', 'chain', 'economy', 'tech', 'domination'] as const) {
      const bucket = bucketForVerb(verb);
      const used: string[] = [];
      for (const d of days) {
        if (verbForDate(d.date) !== verb) continue;
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
      const key = `${d.set_piece_id}:${d.spec.archetype}`;
      const list = byId.get(key) ?? [];
      list.push(d);
      byId.set(key, list);
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

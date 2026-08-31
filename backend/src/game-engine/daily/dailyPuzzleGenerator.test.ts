import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import {
  buildCalibratedMilitarySpec,
  buildDailyPuzzleBase,
  validateDailyPuzzleSpec,
} from './dailyPuzzleService';
import { captureProbability } from '../combat/combatOdds';

/**
 * The calendar's CI review board, pointed at the GENERATOR: every future
 * military day must satisfy the same invariants an authored day does. This is
 * the point of the calibration — "generated" stops being a quality tier.
 */

const mapCache = new Map<string, GameMap>();
function loadMap(mapId: string): GameMap {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(
    readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8'),
  ) as GameMap;
  mapCache.set(mapId, doc);
  return doc;
}

function* datesFrom(start: string, days: number): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// The 90 days after the authored calendar ends.
const SWEEP = [...datesFrom('2026-09-14', 90)];

function militarySpecs() {
  const out = [];
  for (const date of SWEEP) {
    const base = buildDailyPuzzleBase(date);
    if (base.archetype !== 'military_capture') continue;
    const spec = buildCalibratedMilitarySpec(base, loadMap(base.map_id), 18);
    out.push({ date, base, spec });
  }
  return out;
}

describe('calibrated daily generator', () => {
  const days = militarySpecs();

  it('the sweep contains a healthy share of military days and all of them generate', () => {
    expect(days.length).toBeGreaterThanOrEqual(15);
    for (const { date, spec } of days) {
      expect(spec, `${date}: generator returned null`).not.toBeNull();
    }
  });

  it('every generated day passes the persistence validator', () => {
    for (const { date, spec } of days) {
      expect(validateDailyPuzzleSpec(spec), date).not.toBeNull();
      expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify(spec))), date).not.toBeNull();
    }
  });

  it('is deterministic: the same date generates the identical day on any process', () => {
    for (const { date, base } of days.slice(0, 10)) {
      const again = buildCalibratedMilitarySpec(base, loadMap(base.map_id), 18);
      const spec = days.find((d) => d.date === date)!.spec;
      expect(again).toEqual(spec);
    }
  });

  it('every board satisfies the authored feasibility invariants', () => {
    for (const { date, spec } of days) {
      const s = spec!;
      const map = loadMap(s.map_id);
      const ids = new Set(map.territories.map((t) => t.territory_id));
      const board = s.starting_board!;
      expect(Object.keys(board).length, date).toBeGreaterThanOrEqual(2);
      for (const tid of Object.keys(board)) {
        expect(ids.has(tid), `${date}: ${tid} not on ${s.map_id}`).toBe(true);
      }
      expect(board[s.target_territory_id!]?.owner, date).toBe('ai');
      expect(board[s.anchor_territory_id!]?.owner, date).toBe('human');
      expect(s.clear_board, date).toBe(true);
      expect(s.starting_phase, date).toBe('attack');
      expect(s.max_turns, date).toBeGreaterThanOrEqual(6);
      expect(s.max_turns, date).toBeLessThanOrEqual(12);

      // First-assault odds in the authored band, measured exactly the way the
      // calendar test measures authored days.
      const target = s.target_territory_id!;
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
      expect(bestStack, `${date}: no human border force`).toBeGreaterThan(0);
      const p = captureProbability(bestStack, board[target].unit_count, {
        attackerBaseCap: bestConnType === 'sea' ? 2 : 3,
      });
      expect(p, `${date}: P=${p.toFixed(3)}`).toBeGreaterThanOrEqual(0.7);
      expect(p, `${date}: P=${p.toFixed(3)}`).toBeLessThanOrEqual(0.97);
    }
  });

  it('days vary: not one static template wearing five titles', () => {
    const shapes = new Set(
      days.map(({ spec }) => {
        const b = spec!.starting_board!;
        const target = spec!.target_territory_id!;
        const anchor = spec!.anchor_territory_id!;
        return `${b[anchor].unit_count}v${b[target].unit_count}:${Object.keys(b).length}`;
      }),
    );
    // The old template had exactly one shape (8v4:2). Attacker size tracks
    // garrison size (that is the calibration working), so the shape space is
    // deliberately narrow — but it must not be a point.
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });
});

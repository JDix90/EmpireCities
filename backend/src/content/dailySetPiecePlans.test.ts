import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../types';
import { DAILY_SET_PIECES, holdCapableSetPieces, type DailySetPiece } from './dailySetPieces';
import { planFor, plannedSetPieces, SET_PIECE_PLANS } from './dailySetPiecePlans';
import { materialize, type DailyVerb } from '../game-engine/daily/dailySchedule';
import { HOLD_BAND, TACTICAL_BAND_STANDARD } from '../game-engine/daily/dailyGenerator';
import { contextFromSpec, stateFromSpec } from '../game-engine/daily/puzzle/bridge';
import { AI } from '../game-engine/daily/puzzle/model';
import { compilePlan } from '../game-engine/daily/puzzle/opponent';

/**
 * Authoring rules for the v2 opponent plans, checked against the boards the
 * schedule actually deals: a plan that names a territory off the day's board
 * would throw at compile time on the morning it was served.
 */

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(readFileSync(join(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
  mapCache.set(mapId, doc);
  return doc;
}
const deps = { loadMap, simulate: null };
const bands = { tactical: TACTICAL_BAND_STANDARD, hold: HOLD_BAND };
const DATE = '2026-10-05';

function byId(id: string): DailySetPiece {
  const sp = DAILY_SET_PIECES.find((s) => s.id === id);
  if (!sp) throw new Error(`unknown set-piece ${id}`);
  return sp;
}

describe('dailySetPiecePlans — the library', () => {
  it('every planned id is a tactical, region or chain set-piece', () => {
    for (const id of Object.keys(SET_PIECE_PLANS)) {
      const sp = byId(id);
      expect(['tactical', 'region', 'chain'], id).toContain(sp.kind);
    }
  });

  it('a hold plan is authored only for a set-piece that reads both ways', () => {
    const holdCapable = new Set(holdCapableSetPieces().map((sp) => sp.id));
    for (const [id, entry] of Object.entries(SET_PIECE_PLANS)) {
      if (entry.hold) expect(holdCapable.has(id), `${id} has a hold plan but no hold reading`).toBe(true);
    }
    for (const sp of plannedSetPieces('hold')) expect(holdCapable.has(sp.id)).toBe(true);
  });

  it('every plan carries a theme and at least one step', () => {
    for (const [id, entry] of Object.entries(SET_PIECE_PLANS)) {
      for (const [reading, plan] of Object.entries(entry)) {
        expect(plan.theme.length, `${id} ${reading}`).toBeGreaterThan(0);
        expect(plan.plan.steps.length, `${id} ${reading}`).toBeGreaterThan(0);
      }
    }
  });

  it('planFor reads the capture plan on a capture day and the hold plan on a hold day', () => {
    const sp = byId('crossing_the_rubicon');
    expect(planFor(sp, false)?.theme).toBe('cut the supply line');
    expect(planFor(sp, true)?.theme).toBe('the reserve');
    expect(planFor(byId('the_crowns_reach'), true)).toBeNull();
    expect(planFor(byId('the_parthian_shot'), false)?.theme).toBe('the bridge');
  });
});

describe('dailySetPiecePlans — against the boards the schedule deals', () => {
  const readings: Array<{ sp: DailySetPiece; verb: DailyVerb; hold: boolean }> = [];
  for (const kind of ['tactical', 'region', 'chain'] as const) {
    for (const sp of plannedSetPieces(kind)) readings.push({ sp, verb: kind, hold: false });
  }
  for (const sp of plannedSetPieces('hold')) readings.push({ sp, verb: 'hold', hold: true });

  it('covers every authored plan', () => {
    const authored = Object.values(SET_PIECE_PLANS).reduce((n, e) => n + (e.capture ? 1 : 0) + (e.hold ? 1 : 0), 0);
    expect(readings).toHaveLength(authored);
  });

  for (const { sp, verb, hold } of readings) {
    it(`${sp.id} (${verb}): the plan names only the board, moves along edges, and acts from the AI's own territories`, async () => {
      const spec = await materialize(DATE, sp, bands, deps, verb);
      expect(spec, 'materialized').not.toBeNull();
      const map = (await loadMap(spec!.map_id))!;
      const ctx = contextFromSpec(spec!, map);
      const root = stateFromSpec(ctx, spec!);
      const plan = planFor(sp, hold)!;

      // Compiles: every id is on the board.
      expect(() => compilePlan(ctx, plan.plan)).not.toThrow();

      const owner = (id: string) => root.owner[ctx.index.get(id)!];
      const adjacent = (a: string, b: string) => ctx.adj[ctx.index.get(a)!].includes(ctx.index.get(b)!);
      for (const step of plan.plan.steps) {
        if (step.kind === 'draft') {
          expect(owner(step.to), `${sp.id}: draft onto ${step.to}, which the AI does not hold at the start`).toBe(AI);
        } else {
          expect(owner(step.from), `${sp.id}: ${step.kind} from ${step.from}, which the AI does not hold at the start`).toBe(AI);
          expect(adjacent(step.from, step.to), `${sp.id}: ${step.from} does not border ${step.to}`).toBe(true);
          if (step.kind === 'assault') {
            expect(step.keep ?? 1, `${sp.id}: assault keeps at least one`).toBeGreaterThanOrEqual(1);
            expect(step.min_odds ?? 0).toBeGreaterThanOrEqual(0);
            expect(step.min_odds ?? 0).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  }
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DAILY_CALENDAR } from './dailyCalendar';
import { validateDailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleService';
import { captureProbability } from '../game-engine/combat/combatOdds';
import { getEraTechTree } from '../game-engine/eras';
import { DEFAULT_BUILDING_COSTS } from '../game-engine/state/economyManager';
import type { BuildingType, EraId } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';

/**
 * The calendar's own review board. Every authored day is checked against the
 * real map data and the real odds engine, so "balance-checked" is a property
 * of the repo rather than a promise: a board that references a renamed
 * territory, grants too little gold for its own goal, or asks for a capture
 * that is a coin-flip (or a freebie) fails CI before it ever ships a bad day.
 */

interface MapDoc {
  territories: Array<{ territory_id: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
}

const mapCache = new Map<string, MapDoc>();
function loadMap(mapId: string): MapDoc {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const doc = JSON.parse(
    readFileSync(join(__dirname, `../../../database/maps/${mapId}.json`), 'utf-8'),
  ) as MapDoc;
  mapCache.set(mapId, doc);
  return doc;
}

const entries = Object.entries(DAILY_CALENDAR);

describe('daily calendar — integrity', () => {
  it('has entries and well-formed date keys', () => {
    expect(entries.length).toBeGreaterThanOrEqual(14);
    for (const [date] of entries) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every spec passes the persistence validator (JSONB round-trip included)', () => {
    for (const [date, spec] of entries) {
      expect(validateDailyPuzzleSpec(spec), date).not.toBeNull();
      expect(validateDailyPuzzleSpec(JSON.parse(JSON.stringify(spec))), date).not.toBeNull();
    }
  });

  it('seeds and dice seeds are unique across the calendar', () => {
    const seeds = entries.map(([, s]) => s.seed);
    const diceSeeds = entries.map(([, s]) => s.dice_queue_seed);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(diceSeeds).size).toBe(diceSeeds.length);
  });

  it('every referenced territory exists on the entry’s map', () => {
    for (const [date, spec] of entries) {
      const map = loadMap(spec.map_id);
      const ids = new Set(map.territories.map((t) => t.territory_id));
      for (const tid of Object.keys(spec.starting_board ?? {})) {
        expect(ids.has(tid), `${date}: ${tid} not on ${spec.map_id}`).toBe(true);
      }
      if (spec.target_territory_id) expect(ids.has(spec.target_territory_id), date).toBe(true);
      if (spec.anchor_territory_id) expect(ids.has(spec.anchor_territory_id), date).toBe(true);
    }
  });

  it('an attack-phase start always comes with an authored board', () => {
    for (const [date, spec] of entries) {
      if (spec.starting_phase === 'attack') {
        expect(spec.starting_board, date).toBeDefined();
      }
    }
  });
});

describe('daily calendar — feasibility (the balance check)', () => {
  it('military days: the human force borders its target and the capture odds are honest', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype !== 'military_capture') continue;
      expect(spec.starting_board, date).toBeDefined();
      expect(spec.target_territory_id, date).toBeDefined();

      const map = loadMap(spec.map_id);
      const target = spec.target_territory_id!;
      const board = spec.starting_board!;
      const targetUnits = board[target]?.unit_count ?? 0;
      expect(board[target]?.owner, `${date}: target must start AI-held`).toBe('ai');

      // The primary assault: the biggest human stack adjacent to the target.
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
      expect(bestStack, `${date}: no human territory borders ${target}`).toBeGreaterThan(0);

      const p = captureProbability(bestStack, targetUnits, {
        attackerBaseCap: bestConnType === 'sea' ? 2 : 3,
      });
      // Winnable but never free: the whole point of a daily worth ranking.
      expect(p, `${date}: P(capture)=${p.toFixed(3)} out of band`).toBeGreaterThanOrEqual(0.35);
      expect(p, `${date}: P(capture)=${p.toFixed(3)} out of band`).toBeLessThanOrEqual(0.97);
    }
  });

  /**
   * Territories the human opens with. Economy and tech days clear the board and
   * deal it themselves, so this is exact — and it is what per-turn income keys
   * off (economyManager: 1 gold per 3 owned, 1 tech point per 5, both floored
   * at 1).
   */
  function humanTerritories(spec: DailyPuzzleSpec): number {
    return Object.values(spec.starting_board ?? {}).filter((t) => t.owner === 'human').length;
  }
  const goldPerTurn = (n: number) => Math.max(1, Math.floor(n / 3));
  const techPerTurn = (n: number) => Math.max(1, Math.floor(n / 5));

  /**
   * The economy/tech band — the counterpart of the capture-odds band military
   * days are held to, with both halves enforced.
   *
   * The floor used to be the whole rule: "grant enough for your own goal". For
   * these two archetypes the goal IS the win condition, so a grant that covered
   * it made the day complete before the player touched the board — five of
   * fourteen authored days were solvable in one click, and CI was the thing
   * guaranteeing it. The grant now has to leave a shortfall the player earns by
   * holding ground, and the clock has to be long enough to earn it.
   */
  function expectEarnableBand(
    date: string,
    label: string,
    grant: number,
    cost: number,
    perTurn: number,
    maxTurns: number,
  ) {
    expect(grant, `${date}: ${label} grant ${grant} covers the cost ${cost} — the day is a freebie`)
      .toBeLessThan(cost);
    // Income lands on each turn after the first, so a puzzle capped at N turns
    // offers N-1 of it.
    const reachable = grant + perTurn * (maxTurns - 1);
    expect(reachable, `${date}: ${label} unreachable — ${grant} + ${perTurn}/turn over ${maxTurns} turns < ${cost}`)
      .toBeGreaterThanOrEqual(cost);
  }

  it('economy days leave a shortfall the player has to earn, and time to earn it', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype !== 'economy_build') continue;
      const cost = DEFAULT_BUILDING_COSTS[spec.building_type as BuildingType];
      expect(cost, `${date}: unknown building ${spec.building_type}`).toBeDefined();
      // Income is only computable from the spec when the board is fully dealt here.
      expect(spec.clear_board, `${date}: economy days must clear the board`).toBe(true);
      expectEarnableBand(
        date, 'gold', spec.grants?.gold ?? 0, cost,
        goldPerTurn(humanTerritories(spec)), spec.max_turns,
      );
    }
  });

  it('tech days name a real node, leave a shortfall, and give time to earn it', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype !== 'tech_research') continue;
      const tree = getEraTechTree(spec.era_id as EraId);
      const node = tree.find((n) => n.tech_id === spec.tech_id);
      expect(node, `${date}: ${spec.tech_id} not in ${spec.era_id} tree`).toBeDefined();
      expect(spec.clear_board, `${date}: tech days must clear the board`).toBe(true);
      // A tech day runs with economy on, so initializeGameState's bootstrap
      // would hand out starting points the grant could not lower (grants are
      // floors). Pin it off so the grant is the real opening budget.
      expect(
        spec.settings_overrides?.economy_tech_starting_tech_points,
        `${date}: pin economy_tech_starting_tech_points to 0 so the grant is the budget`,
      ).toBe(0);
      expectEarnableBand(
        date, 'tech point', spec.grants?.tech_points ?? 0, node!.cost,
        techPerTurn(humanTerritories(spec)), spec.max_turns,
      );
    }
  });

  it('non-domination days keep a tight, honest clock', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype === 'domination') continue;
      expect(spec.max_turns, date).toBeGreaterThanOrEqual(4);
      expect(spec.max_turns, date).toBeLessThanOrEqual(20);
    }
  });
});

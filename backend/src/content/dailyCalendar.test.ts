import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DAILY_CALENDAR } from './dailyCalendar';
import { validateDailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleService';
import { captureProbability } from '../game-engine/combat/combatOdds';
import { getEraTechTree } from '../game-engine/eras';
import { DEFAULT_BUILDING_COSTS } from '../game-engine/state/economyManager';
import type { BuildingType, EraId } from '../types';

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

  it('economy days grant enough gold for their own goal', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype !== 'economy_build') continue;
      const cost = DEFAULT_BUILDING_COSTS[spec.building_type as BuildingType];
      expect(cost, `${date}: unknown building ${spec.building_type}`).toBeDefined();
      expect(spec.grants?.gold ?? 0, `${date}: grant below cost`).toBeGreaterThanOrEqual(cost);
    }
  });

  it('tech days name a real node and grant enough points for it', () => {
    for (const [date, spec] of entries) {
      if (spec.archetype !== 'tech_research') continue;
      const tree = getEraTechTree(spec.era_id as EraId);
      const node = tree.find((n) => n.tech_id === spec.tech_id);
      expect(node, `${date}: ${spec.tech_id} not in ${spec.era_id} tree`).toBeDefined();
      expect(spec.grants?.tech_points ?? 0, `${date}: grant below cost`).toBeGreaterThanOrEqual(node!.cost);
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

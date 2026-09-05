import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DAILY_SET_PIECES, setPiecesOfKind } from './dailySetPieces';
import { validateDailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleService';
import { getEraTechTree } from '../game-engine/eras';
import { DEFAULT_BUILDING_COSTS } from '../game-engine/state/economyManager';
import { bucketForVerb, WEEKDAY_CADENCE } from '../game-engine/daily/dailySchedule';

/**
 * The library's review board. A set-piece carries no numbers, so what can go
 * wrong is structural: a territory that is not on the map, a front whose
 * anchor does not border its target, a tech the era does not have. Each of
 * those would surface as a warning in production and a fallback day for the
 * player; here it fails CI instead.
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

function borders(map: MapDoc, a: string, b: string): boolean {
  return map.connections.some(
    (c) => (c.from === a && c.to === b) || (c.from === b && c.to === a),
  );
}

describe('daily set-pieces — integrity', () => {
  it('ids are unique and stable-looking', () => {
    const ids = DAILY_SET_PIECES.map((sp) => sp.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('every cadence verb has at least one set-piece, so the generator fallback is never the plan', () => {
    const verbs = new Set(
      Object.values(WEEKDAY_CADENCE)
        .flatMap((slot) => [...slot.cycle])
        .filter((v): v is Exclude<typeof v, 'any'> => v !== 'any'),
    );
    for (const verb of verbs) {
      expect(bucketForVerb(verb).length, `no set-pieces for ${verb}`).toBeGreaterThan(0);
    }
  });

  it('every referenced territory exists on the entry’s map', () => {
    for (const sp of DAILY_SET_PIECES) {
      const mapId = sp.kind === 'domination' ? sp.spec.map_id : sp.map_id;
      const ids = new Set(loadMap(mapId).territories.map((t) => t.territory_id));
      const refs: string[] =
        sp.kind === 'tactical'
          ? [sp.anchor, sp.target, sp.support, sp.relief, ...(sp.extra_ai ?? [])].filter(
              (x): x is string => typeof x === 'string',
            )
          : sp.kind === 'chain'
            ? [sp.anchor, ...sp.targets, sp.support, sp.relief, ...(sp.extra_ai ?? [])].filter(
                (x): x is string => typeof x === 'string',
              )
            : sp.kind === 'region'
              ? [...sp.human, ...sp.ai, sp.support, ...(sp.extra_ai ?? [])].filter((x): x is string => typeof x === 'string')
              : sp.kind === 'domination'
                ? Object.keys(sp.spec.starting_board ?? {})
                : [...sp.human, ...sp.ai];
      for (const tid of refs) {
        expect(ids.has(tid), `${sp.id}: ${tid} not on ${mapId}`).toBe(true);
      }
    }
  });
});

describe('daily set-pieces — shape', () => {
  it('tactical: the anchor borders the target, support borders the anchor, relief borders the target', () => {
    for (const sp of setPiecesOfKind('tactical')) {
      const map = loadMap(sp.map_id);
      expect(borders(map, sp.anchor, sp.target), `${sp.id}: anchor must border target`).toBe(true);
      if (sp.support) {
        expect(borders(map, sp.support, sp.anchor), `${sp.id}: support must border anchor`).toBe(true);
      }
      if (sp.relief) {
        expect(borders(map, sp.relief, sp.target), `${sp.id}: relief must border target`).toBe(true);
      }
      const named = [sp.anchor, sp.target, sp.support, sp.relief, ...(sp.extra_ai ?? [])].filter(Boolean);
      expect(new Set(named).size, `${sp.id}: territories must be distinct`).toBe(named.length);
    }
  });

  it('tactical: a front that reads both ways names its defended side, and has a reserve to fortify', () => {
    for (const sp of setPiecesOfKind('tactical')) {
      if (!sp.hold) continue;
      expect(sp.hold.title.trim().length, sp.id).toBeGreaterThan(0);
      expect(sp.hold.intro.trim().length, sp.id).toBeGreaterThan(0);
      expect(sp.hold.title, `${sp.id}: hold title must differ from the capture title`).not.toBe(sp.title);
      // The relief territory becomes the human's reserve; without one the
      // defence has no second move.
      expect(sp.relief, `${sp.id}: a hold day needs a relief territory to serve as the reserve`).toBeDefined();
    }
  });

  it('region: human + AI holdings are exactly the region, every garrison is reachable, support borders the human side', () => {
    for (const sp of setPiecesOfKind('region')) {
      const map = loadMap(sp.map_id);
      const doc = JSON.parse(readFileSync(join(__dirname, `../../../database/maps/${sp.map_id}.json`), 'utf-8')) as {
        territories: Array<{ territory_id: string; region_id?: string }>;
      };
      const region = doc.territories.filter((t) => t.region_id === sp.region_id).map((t) => t.territory_id).sort();
      expect(region.length, `${sp.id}: region ${sp.region_id} not on ${sp.map_id}`).toBeGreaterThan(0);
      expect([...sp.human, ...sp.ai].sort(), `${sp.id}: holdings must be exactly the region`).toEqual(region);
      const humanSide = [...sp.human, ...(sp.support ? [sp.support] : [])];
      for (const g of sp.ai) {
        expect(humanSide.some((h) => borders(map, h, g)), `${sp.id}: garrison ${g} borders no human territory`).toBe(true);
      }
      if (sp.support) {
        expect(region.includes(sp.support), `${sp.id}: support must sit outside the region`).toBe(false);
        expect(sp.human.some((h) => borders(map, h, sp.support!)), `${sp.id}: support must border the human side`).toBe(true);
      }
    }
  });

  it('chain: the first target borders the anchor, each next borders the previous, relief borders the last', () => {
    for (const sp of setPiecesOfKind('chain')) {
      const map = loadMap(sp.map_id);
      expect(borders(map, sp.anchor, sp.targets[0]), `${sp.id}: anchor must border the first target`).toBe(true);
      for (let i = 1; i < sp.targets.length; i++) {
        expect(borders(map, sp.targets[i - 1], sp.targets[i]), `${sp.id}: ${sp.targets[i]} must border ${sp.targets[i - 1]}`).toBe(true);
      }
      if (sp.support) expect(borders(map, sp.support, sp.anchor), `${sp.id}: support must border anchor`).toBe(true);
      if (sp.relief) expect(borders(map, sp.relief, sp.targets[sp.targets.length - 1]), `${sp.id}: relief must border the last target`).toBe(true);
      const named = [sp.anchor, ...sp.targets, sp.support, sp.relief, ...(sp.extra_ai ?? [])].filter(Boolean);
      expect(new Set(named).size, `${sp.id}: territories must be distinct`).toBe(named.length);
    }
  });

  it('economy: holdings are non-empty and disjoint, and the building is priced', () => {
    for (const sp of setPiecesOfKind('economy')) {
      expect(sp.human.length, sp.id).toBeGreaterThan(0);
      expect(sp.ai.length, sp.id).toBeGreaterThan(0);
      expect(sp.human.some((t) => sp.ai.includes(t)), `${sp.id}: overlapping holdings`).toBe(false);
      expect(DEFAULT_BUILDING_COSTS[sp.building_type], `${sp.id}: ${sp.building_type} has no cost`).toBeGreaterThan(0);
    }
  });

  it('tech: holdings are non-empty and disjoint, and the tech is in the era’s tree', () => {
    for (const sp of setPiecesOfKind('tech')) {
      expect(sp.human.length, sp.id).toBeGreaterThan(0);
      expect(sp.ai.length, sp.id).toBeGreaterThan(0);
      expect(sp.human.some((t) => sp.ai.includes(t)), `${sp.id}: overlapping holdings`).toBe(false);
      const node = getEraTechTree(sp.era_id).find((n) => n.tech_id === sp.tech_id);
      expect(node, `${sp.id}: ${sp.tech_id} not in the ${sp.era_id} tree`).toBeDefined();
    }
  });

  it('domination: the spec is complete apart from the dice stream', () => {
    for (const sp of setPiecesOfKind('domination')) {
      expect(sp.spec.archetype).toBe('domination');
      expect(sp.spec.player_count, sp.id).toBe(2);
      expect(validateDailyPuzzleSpec({ ...sp.spec, dice_queue_seed: 1 }), sp.id).not.toBeNull();
    }
  });
});

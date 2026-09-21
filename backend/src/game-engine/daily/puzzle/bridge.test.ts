/**
 * The bridge reads the same tables the engine reads: adjacency and sea lanes
 * from the map, the era doctrine from ERA_DEFAULTS, region bonuses, the
 * objective from the spec. Checked on real maps.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../../types';
import type { DailyPuzzleSpec } from '../dailyPuzzleTypes';
import { contextFromSpec, inferPlan, stateFromSpec } from './bridge';
import { HUMAN, AI, PHASE_ATTACK, PHASE_DRAFT, reinforcements } from './model';

function loadMap(mapId: string): GameMap {
  return JSON.parse(readFileSync(join(__dirname, `../../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;
}

function spec(over: Partial<DailyPuzzleSpec>): DailyPuzzleSpec {
  return {
    archetype: 'military_capture',
    title: 't', intro: 'i', goal: 'g',
    era_id: 'medieval', map_id: 'era_medieval',
    seed: 1, player_count: 2, max_turns: 3, dice_queue_seed: 1,
    ...over,
  };
}

describe('contextFromSpec', () => {
  it('sees the Channel as a sea lane and the era doctrine as medieval (no rerolls, 3 dice at sea)', () => {
    const map = loadMap('era_medieval');
    const s = spec({
      target_territory_id: 'england', anchor_territory_id: 'france', starting_phase: 'attack', clear_board: true,
      starting_board: { france: { owner: 'human', unit_count: 9 }, iberia: { owner: 'human', unit_count: 4 }, england: { owner: 'ai', unit_count: 5 } },
    });
    const ctx = contextFromSpec(s, map);
    const f = ctx.index.get('france')!;
    const e = ctx.index.get('england')!;
    expect(ctx.adj[f]).toContain(e);
    expect(ctx.seaEdges.has(f < e ? `${f}-${e}` : `${e}-${f}`)).toBe(true);
    expect(ctx.seaCap).toBe(3);
    expect(ctx.doctrine).toEqual({ legionReroll: false, rifleDoctrine: false });
    expect(ctx.fortifyMoves).toBe(1);
    const root = stateFromSpec(ctx, s);
    expect(root.phase).toBe(PHASE_ATTACK);
    expect(root.draftLeft).toBe(0);
    expect(root.owner[e]).toBe(AI);
    expect(root.units[f]).toBe(9);
  });

  it('caps sea assaults at two dice in the Discovery era and rerolls legions in the Ancient one', () => {
    const disc = contextFromSpec(spec({
      era_id: 'discovery', map_id: 'era_discovery', target_territory_id: 'england_disc', anchor_territory_id: 'france_disc',
      starting_board: { france_disc: { owner: 'human', unit_count: 8 }, england_disc: { owner: 'ai', unit_count: 4 } },
    }), loadMap('era_discovery'));
    expect(disc.seaCap).toBe(2);
    const anc = contextFromSpec(spec({
      era_id: 'ancient', map_id: 'era_ancient', target_territory_id: 'italia', anchor_territory_id: 'gaul',
      starting_board: { gaul: { owner: 'human', unit_count: 8 }, italia: { owner: 'ai', unit_count: 4 } },
    }), loadMap('era_ancient'));
    expect(anc.doctrine.legionReroll).toBe(true);
    const acw = contextFromSpec(spec({
      era_id: 'acw', map_id: 'era_acw', target_territory_id: 'acw_kentucky', anchor_territory_id: 'acw_ohio_indiana',
      starting_board: { acw_ohio_indiana: { owner: 'human', unit_count: 8 }, acw_kentucky: { owner: 'ai', unit_count: 4 } },
    }), loadMap('era_acw'));
    expect(acw.doctrine.rifleDoctrine).toBe(true);
  });

  it('opens a draft-start day with the engine\'s reinforcement count', () => {
    const map = loadMap('era_ancient');
    const s = spec({
      era_id: 'ancient', map_id: 'era_ancient', archetype: 'hold_territory', target_territory_id: 'italia', anchor_territory_id: 'gaul',
      starting_board: { italia: { owner: 'human', unit_count: 6 }, greece: { owner: 'human', unit_count: 3 }, gaul: { owner: 'ai', unit_count: 10 } },
    });
    const ctx = contextFromSpec(s, map);
    const root = stateFromSpec(ctx, s);
    expect(root.phase).toBe(PHASE_DRAFT);
    // Two territories: max(3, floor(2/3)) = 3, no full region.
    expect(root.draftLeft).toBe(3);
    expect(reinforcements(ctx, root, HUMAN)).toBe(3);
    const plan = inferPlan(s, ctx);
    expect(plan.steps.some((st) => st.kind === 'assault' && st.from === 'gaul' && st.to === 'italia')).toBe(true);
  });

  it('refuses an objective that is not on the board', () => {
    const map = loadMap('era_ancient');
    expect(() => contextFromSpec(spec({
      era_id: 'ancient', map_id: 'era_ancient', target_territory_id: 'italia', anchor_territory_id: 'gaul',
      starting_board: { gaul: { owner: 'human', unit_count: 8 } },
    }), map)).toThrow(/objective territory/);
  });
});

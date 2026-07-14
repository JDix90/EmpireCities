import { describe, expect, it } from 'vitest';
import {
  computePhaseAdjacencyTargets,
  listNeighborTargets,
  computeValidSources,
  computeFortifyReachable,
} from './mapAdjacencyTargets';
import type { GameState } from '../store/gameStore';

function miniState(phase: GameState['phase']): GameState {
  return {
    phase,
    territories: {
      rome: { territory_id: 'rome', owner_id: 'p1', unit_count: 5 },
      milan: { territory_id: 'milan', owner_id: 'p2', unit_count: 3 },
      turin: { territory_id: 'turin', owner_id: 'p1', unit_count: 4 },
    },
    players: [
      { player_id: 'p1', username: 'Human', color: '#f00', player_index: 0, is_ai: false },
      { player_id: 'p2', username: 'AI', color: '#00f', player_index: 1, is_ai: true },
    ],
  } as unknown as GameState;
}

const connections = [
  { from: 'rome', to: 'milan', type: 'land' as const },
  { from: 'rome', to: 'turin', type: 'land' as const },
];

describe('computePhaseAdjacencyTargets', () => {
  it('returns enemy neighbors during attack phase', () => {
    const targets = computePhaseAdjacencyTargets(miniState('attack'), connections, {
      attackSource: 'rome',
    });
    expect(targets.has('milan')).toBe(true);
    expect(targets.has('turin')).toBe(false);
  });

  it('returns friendly neighbors during fortify phase', () => {
    const targets = computePhaseAdjacencyTargets(miniState('fortify'), connections, {
      attackSource: 'rome',
    });
    expect(targets.has('turin')).toBe(true);
    expect(targets.has('milan')).toBe(false);
  });

  it('excludes neutral (unowned) neighbors from attack by default', () => {
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier',
      owner_id: null,
      unit_count: 3,
    };
    const conns = [...connections, { from: 'rome', to: 'frontier', type: 'land' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('frontier')).toBe(false);
  });

  it('allows attacking neutral frontier neighbors in era-advancement games', () => {
    // Growth spawns neutral frontiers; the backend lets you capture them, so a
    // bordering frontier must be offered as an attack target (issue: unreachable).
    const state = miniState('attack');
    (state as unknown as { settings: { era_advancement_enabled: boolean } }).settings = {
      era_advancement_enabled: true,
    };
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier',
      owner_id: null,
      unit_count: 3,
    };
    const conns = [...connections, { from: 'rome', to: 'frontier', type: 'land' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('frontier')).toBe(true);
    expect(targets.has('milan')).toBe(true); // enemy still attackable
    expect(targets.has('turin')).toBe(false); // own territory still excluded
  });

  it('offers an ORBIT-connected neutral (the Moon) as an attack target even without era advancement', () => {
    // Standalone Space Age: the backend allows conquering the neutral Moon once the
    // attacker has orbit access, but the quick-list previously hid it. Off-world
    // neutrals are reached via `orbit` connections, so they must be admitted.
    const state = miniState('attack'); // no settings → era advancement off
    (state.territories as Record<string, unknown>).moon = {
      territory_id: 'moon',
      owner_id: null,
      unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'moon', type: 'orbit' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('moon')).toBe(true);
  });

  it('drops the orbit-connected Moon on the globe (per-world territoryFilter)', () => {
    // On the globe the caller scopes to the active world; the cross-world Moon
    // endpoint is filtered out, so it only surfaces in the unfiltered quick-list.
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).moon = {
      territory_id: 'moon',
      owner_id: null,
      unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'moon', type: 'orbit' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, {
      attackSource: 'rome',
      territoryFilter: (id) => id !== 'moon', // active world excludes the Moon
    });
    expect(targets.has('moon')).toBe(false);
  });
});

describe('computeFortifyReachable', () => {
  it('walks a multi-hop chain of the owner\'s territories (mirrors backend pathExists)', () => {
    const state = miniState('fortify');
    // rome(p1) — turin(p1) — venice(p1): venice is 2 hops from rome, all p1.
    (state.territories as Record<string, unknown>).venice = {
      territory_id: 'venice', owner_id: 'p1', unit_count: 2,
    };
    const conns = [...connections, { from: 'turin', to: 'venice', type: 'land' as const }];
    const reachable = computeFortifyReachable(state, conns, 'rome', 'p1');
    expect(reachable.has('turin')).toBe(true);
    expect(reachable.has('venice')).toBe(true); // multi-hop through turin
    expect(reachable.has('milan')).toBe(false); // enemy blocks the path
    expect(reachable.has('rome')).toBe(false);  // excludes the source itself
  });

  it('stops at enemy territories — no path through non-owned land', () => {
    const state = miniState('fortify');
    // rome(p1) — milan(p2) — genoa(p1): genoa is unreachable (milan is enemy).
    (state.territories as Record<string, unknown>).genoa = {
      territory_id: 'genoa', owner_id: 'p1', unit_count: 3,
    };
    const conns = [...connections, { from: 'milan', to: 'genoa', type: 'land' as const }];
    const reachable = computeFortifyReachable(state, conns, 'rome', 'p1');
    expect(reachable.has('turin')).toBe(true);
    expect(reachable.has('genoa')).toBe(false);
  });
});

describe('computeValidSources', () => {
  it('attack: owns ≥2 units and borders an enemy', () => {
    const sources = computeValidSources(miniState('attack'), connections, 'p1');
    expect(sources.has('rome')).toBe(true);  // borders milan (p2)
    expect(sources.has('turin')).toBe(false); // only borders rome (own) — no enemy
    expect(sources.has('milan')).toBe(false); // not the viewer's
  });

  it('fortify: owns ≥2 units and can reach another owned territory', () => {
    const sources = computeValidSources(miniState('fortify'), connections, 'p1');
    expect(sources.has('rome')).toBe(true);  // reaches turin
    expect(sources.has('turin')).toBe(true); // reaches rome
    expect(sources.has('milan')).toBe(false);
  });

  it('excludes single-unit territories (nothing to move / attack with)', () => {
    const state = miniState('attack');
    (state.territories as Record<string, { unit_count: number }>).rome.unit_count = 1;
    const sources = computeValidSources(state, connections, 'p1');
    expect(sources.has('rome')).toBe(false);
  });

  it('is empty outside attack/fortify phases', () => {
    expect(computeValidSources(miniState('draft'), connections, 'p1').size).toBe(0);
    expect(computeValidSources(miniState('territory_select'), connections, 'p1').size).toBe(0);
  });

  it('is empty without a viewer id', () => {
    expect(computeValidSources(miniState('attack'), connections, null).size).toBe(0);
  });

  it('attack: counts era-advancement neutral frontiers as attackable', () => {
    const state = miniState('attack');
    (state as unknown as { settings: { era_advancement_enabled: boolean } }).settings = {
      era_advancement_enabled: true,
    };
    // turin(p1) now borders a neutral frontier → becomes a valid attack source.
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier', owner_id: null, unit_count: 2,
    };
    const conns = [...connections, { from: 'turin', to: 'frontier', type: 'land' as const }];
    const sources = computeValidSources(state, conns, 'p1');
    expect(sources.has('turin')).toBe(true);
  });

  it('respects the world territoryFilter (galaxy scoping)', () => {
    const state = miniState('fortify');
    (state.territories as Record<string, unknown>).offworld = {
      territory_id: 'offworld', owner_id: 'p1', unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'offworld', type: 'orbit' as const }];
    // Filter to the home world only → offworld is excluded as a source, and rome's
    // only in-world friendly reach (turin) still keeps rome valid.
    const homeOnly = (id: string) => id !== 'offworld';
    const sources = computeValidSources(state, conns, 'p1', { territoryFilter: homeOnly });
    expect(sources.has('offworld')).toBe(false);
    expect(sources.has('rome')).toBe(true);
  });
});

describe('listNeighborTargets — hyperspace (orbit) targets', () => {
  it('flags cross-world orbit targets, names the destination world, and leaves land targets plain', () => {
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).verdan_aurora = {
      territory_id: 'verdan_aurora',
      owner_id: 'p2',
      unit_count: 2,
    };
    const conns = [
      { from: 'rome', to: 'milan', type: 'land' as const },
      { from: 'rome', to: 'verdan_aurora', type: 'orbit' as const },
    ];
    const names = new Map([
      ['milan', 'Milan'],
      ['verdan_aurora', 'Aurora'],
    ]);

    const rows = listNeighborTargets(state, conns, 'rome', names, {
      attackSource: 'rome',
      worldNameOf: (id) => (id === 'verdan_aurora' ? 'Verdan Reach' : undefined),
    });

    const orbitRow = rows.find((r) => r.territoryId === 'verdan_aurora');
    const landRow = rows.find((r) => r.territoryId === 'milan');
    expect(orbitRow?.isOrbit).toBe(true);
    expect(orbitRow?.targetWorldName).toBe('Verdan Reach');
    expect(landRow?.isOrbit).toBe(false);
    expect(landRow?.targetWorldName).toBeUndefined();
  });
});

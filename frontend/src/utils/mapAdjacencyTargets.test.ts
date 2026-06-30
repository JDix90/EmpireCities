import { describe, expect, it } from 'vitest';
import { computePhaseAdjacencyTargets, listNeighborTargets } from './mapAdjacencyTargets';
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

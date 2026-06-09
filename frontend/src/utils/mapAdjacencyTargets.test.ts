import { describe, expect, it } from 'vitest';
import { computePhaseAdjacencyTargets } from './mapAdjacencyTargets';
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
});

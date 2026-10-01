import { describe, it, expect } from 'vitest';
import { boardKeyOf, projectMapToBoard } from './projectMapToBoard';

const map = {
  map_id: 'era_test',
  territories: [
    { territory_id: 'gaul', name: 'Gaul', region_id: 'west' },
    { territory_id: 'italia', name: 'Italia', region_id: 'west' },
    { territory_id: 'parthia', name: 'Parthia', region_id: 'east' },
    // Authored for a later era: not in play at game start.
    { territory_id: 'vinland', name: 'Vinland', region_id: 'americas', unlock_era_index: 2 },
  ],
  connections: [
    { from: 'gaul', to: 'italia', type: 'land' },
    { from: 'italia', to: 'parthia', type: 'sea' },
    { from: 'gaul', to: 'vinland', type: 'sea' },
  ],
  regions: [
    { region_id: 'west', name: 'The West', bonus: 3 },
    { region_id: 'east', name: 'The East', bonus: 2 },
    { region_id: 'americas', name: 'The Americas', bonus: 4 },
  ],
};

describe('projectMapToBoard', () => {
  it('drops territories, connections and regions that are not in play', () => {
    const board = projectMapToBoard(map, new Set(['gaul', 'italia', 'parthia']));
    expect(board.territories.map((t) => t.territory_id)).toEqual(['gaul', 'italia', 'parthia']);
    expect(board.connections).toEqual([
      { from: 'gaul', to: 'italia', type: 'land' },
      { from: 'italia', to: 'parthia', type: 'sea' },
    ]);
    expect(board.regions?.map((r) => r.region_id)).toEqual(['west', 'east']);
    expect(board.map_id).toBe('era_test');
  });

  it('returns the same object when every authored territory is in play', () => {
    const all = new Set(map.territories.map((t) => t.territory_id));
    expect(projectMapToBoard(map, all)).toBe(map);
  });

  it('grows with the board when a frontier unlocks', () => {
    const later = projectMapToBoard(map, new Set(['gaul', 'italia', 'parthia', 'vinland']));
    expect(later).toBe(map);
  });

  it('leaves regions undefined when the map has none', () => {
    const { regions: _regions, ...noRegions } = map;
    const board = projectMapToBoard(noRegions, new Set(['gaul']));
    expect('regions' in board).toBe(false);
    expect(board.territories).toHaveLength(1);
  });
});

describe('boardKeyOf', () => {
  it('is order-independent and empty for a missing state', () => {
    expect(boardKeyOf({ b: 1, a: 1 })).toBe('a|b');
    expect(boardKeyOf(null)).toBe('');
  });
});

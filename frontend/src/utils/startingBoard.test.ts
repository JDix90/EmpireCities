import { describe, it, expect } from 'vitest';
import { startingBoardTerritoryCount } from './startingBoard';

const territories = [
  { territory_id: 'gaul' },
  { territory_id: 'italia', unlock_era_index: 0 },
  { territory_id: 'vinland', unlock_era_index: 2 },
  { territory_id: 'antarctica', unlock_era_index: 5 },
];

describe('startingBoardTerritoryCount', () => {
  it('leaves era-locked frontiers out of the count', () => {
    expect(startingBoardTerritoryCount({ map_id: 'era_ancient', territories })).toBe(2);
  });

  it('counts a map with no frontiers whole', () => {
    expect(startingBoardTerritoryCount({ map_id: 'community_britain_925', territories: territories.slice(0, 2) })).toBe(2);
  });

  it('counts the standalone Space Age whole: its frontiers are dealt from turn one', () => {
    expect(startingBoardTerritoryCount({ map_id: 'era_space_age', territories })).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { getInfluenceHopLimit, isTerritoryReachableWithinHops } from './influenceManager';
import type { GameMap } from '../../types';
import type { TechNode } from '../eras/types';

const techTree: TechNode[] = [
  { tech_id: 'cw_propaganda', name: 'Propaganda', description: '', tier: 1, cost: 1, unlocks_ability: 'propaganda_extended' },
  { tech_id: 'other', name: 'Other', description: '', tier: 1, cost: 1 },
];

describe('getInfluenceHopLimit', () => {
  it('uses base + wonder when no range tech is unlocked', () => {
    expect(getInfluenceHopLimit({
      baseHopLimit: 1,
      unlockedTechs: [],
      techTree,
      wonderRangeBonus: 2,
    })).toBe(3);
  });

  it('adds +1 when range tech unlock is researched', () => {
    expect(getInfluenceHopLimit({
      baseHopLimit: 1,
      unlockedTechs: ['cw_propaganda'],
      techTree,
      wonderRangeBonus: 1,
    })).toBe(3);
  });
});

describe('isTerritoryReachableWithinHops', () => {
  const map: GameMap = {
    map_id: 'm',
    name: 'Map',
    territories: [],
    regions: [],
    connections: [
      { from: 'a', to: 'b', type: 'land' },
      { from: 'b', to: 'c', type: 'land' },
      { from: 'c', to: 'd', type: 'land' },
    ],
  };

  it('returns true for 1-hop neighbor', () => {
    expect(isTerritoryReachableWithinHops({
      map,
      ownedTerritoryIds: ['a'],
      targetId: 'b',
      hopLimit: 1,
    })).toBe(true);
  });

  it('returns false when target is beyond hop limit', () => {
    expect(isTerritoryReachableWithinHops({
      map,
      ownedTerritoryIds: ['a'],
      targetId: 'd',
      hopLimit: 2,
    })).toBe(false);
  });
});

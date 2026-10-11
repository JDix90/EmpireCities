import { describe, it, expect } from 'vitest';
import type { GameMap } from '../../types';
import { MIN_REGION_TERRITORIES, payableRegionBonuses, regionsOnBoard } from './regionsOnBoard';

const map = {
  territories: [
    { territory_id: 'a1', region_id: 'a' },
    { territory_id: 'a2', region_id: 'a' },
    { territory_id: 'a3', region_id: 'a' },
    { territory_id: 'b1', region_id: 'b' },
    { territory_id: 'b2', region_id: 'b' },
    { territory_id: 'solo', region_id: 'island' },
  ],
  regions: [
    { region_id: 'a', name: 'A', bonus: 3 },
    { region_id: 'b', name: 'B', bonus: 2 },
    { region_id: 'island', name: 'Island', bonus: 4 },
    { region_id: 'empty', name: 'Empty', bonus: 1 },
  ],
} as unknown as Pick<GameMap, 'territories' | 'regions'>;

const board = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { territory_id: id }]));

describe('regionsOnBoard', () => {
  it('lists each region by its territories on the board', () => {
    const regions = regionsOnBoard(map, board('a1', 'a2', 'a3', 'b1', 'b2'));
    expect(regions.get('a')).toEqual(['a1', 'a2', 'a3']);
    expect(regions.get('b')).toEqual(['b1', 'b2']);
  });

  it('leaves out territories not on the board (a growing board\'s locked frontier)', () => {
    expect(regionsOnBoard(map, board('a1', 'a3', 'b1', 'b2')).get('a')).toEqual(['a1', 'a3']);
  });

  it('leaves out a region with fewer than two territories on the board', () => {
    expect(MIN_REGION_TERRITORIES).toBe(2);
    const regions = regionsOnBoard(map, board('a1', 'a2', 'a3', 'b1', 'solo'));
    expect(regions.has('b')).toBe(false); // b2 still locked
    expect(regions.has('island')).toBe(false); // authored with one territory
    expect(regions.has('empty')).toBe(false); // none at all
    expect([...regions.keys()]).toEqual(['a']);
  });
});

describe('payableRegionBonuses', () => {
  it('ranks ground by a region only where the region can pay', () => {
    expect(payableRegionBonuses(map, board('a1', 'a2', 'b1', 'solo'))).toEqual({ a: 3, b: 0, island: 0, empty: 0 });
    expect(payableRegionBonuses(map, board('a1', 'a2', 'b1', 'b2'))).toEqual({ a: 3, b: 2, island: 0, empty: 0 });
  });
});

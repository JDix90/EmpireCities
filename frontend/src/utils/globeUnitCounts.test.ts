import { describe, it, expect } from 'vitest';
import {
  COUNT_BADGE_MIN_GAP_PX,
  countBadgeFill,
  countTier,
  facesCamera,
  placeCountBadges,
  sortCountCandidates,
  type CountCandidate,
  type ScreenSpot,
} from './globeUnitCounts';

describe('countTier', () => {
  const near = new Set(['france', 'italy']);
  it('ranks the selection, then its neighbours, then the viewer’s own, then the rest', () => {
    expect(countTier('hre', 'hre', near, 'p2', 'p1')).toBe(0);
    expect(countTier('france', 'hre', near, 'p2', 'p1')).toBe(1);
    expect(countTier('spain', 'hre', near, 'p1', 'p1')).toBe(2);
    expect(countTier('spain', 'hre', near, 'p2', 'p1')).toBe(3);
  });

  it('gives a spectator no own territories', () => {
    expect(countTier('spain', null, new Set(), 'p1', null)).toBe(3);
  });
});

describe('sortCountCandidates', () => {
  it('orders by tier, then bigger stacks, then id', () => {
    const order = sortCountCandidates<CountCandidate>([
      { id: 'b', tier: 3, count: 4 },
      { id: 'a', tier: 3, count: 4 },
      { id: 'big', tier: 3, count: 20 },
      { id: 'mine', tier: 2, count: 1 },
      { id: 'sel', tier: 0, count: 1 },
    ]).map((c) => c.id);
    expect(order).toEqual(['sel', 'mine', 'big', 'a', 'b']);
  });
});

describe('placeCountBadges (the room rule)', () => {
  const spots: Record<string, ScreenSpot> = {
    sel: { x: 100, y: 100, onScreen: true },
    nb: { x: 110, y: 100, onScreen: true },
    mine: { x: 120, y: 100, onScreen: true },
    far: { x: 300, y: 300, onScreen: true },
    behind: { x: 500, y: 500, onScreen: false },
  };
  const spotOf = (id: string) => spots[id] ?? null;

  it('always shows the selection and its neighbours, even crowded together', () => {
    const ids = placeCountBadges([
      { id: 'sel', tier: 0, count: 3 },
      { id: 'nb', tier: 1, count: 3 },
    ], spotOf);
    expect(ids).toEqual(['sel', 'nb']);
  });

  it('shows any other count only where it has room', () => {
    const ids = placeCountBadges([
      { id: 'sel', tier: 0, count: 3 },
      { id: 'mine', tier: 2, count: 9 },
      { id: 'far', tier: 3, count: 1 },
    ], spotOf);
    expect(ids).toEqual(['sel', 'far']);
  });

  it('lets the first of two crowded counts keep its place', () => {
    const ids = placeCountBadges([
      { id: 'mine', tier: 2, count: 9 },
      { id: 'nbAsOther', tier: 3, count: 30 },
    ], (id) => (id === 'nbAsOther' ? { x: 120 + COUNT_BADGE_MIN_GAP_PX - 1, y: 100, onScreen: true } : spotOf(id)));
    expect(ids).toEqual(['mine']);
  });

  it('shows a count exactly the gap away', () => {
    const ids = placeCountBadges([
      { id: 'mine', tier: 2, count: 9 },
      { id: 'next', tier: 3, count: 1 },
    ], (id) => (id === 'next' ? { x: 120 + COUNT_BADGE_MIN_GAP_PX, y: 100, onScreen: true } : spotOf(id)));
    expect(ids).toEqual(['mine', 'next']);
  });

  it('never shows a count that is off screen or has no position, selected or not', () => {
    expect(placeCountBadges([{ id: 'behind', tier: 0, count: 3 }, { id: 'gone', tier: 1, count: 3 }], spotOf)).toEqual([]);
  });
});

describe('facesCamera', () => {
  it('keeps what is in front of the camera and drops the far side', () => {
    const view = { lat: 45, lng: 15, altitude: 2.75 };
    expect(facesCamera(48, 10, view)).toBe(true);
    expect(facesCamera(40, -100, view)).toBe(false);
    expect(facesCamera(-45, -165, view)).toBe(false);
  });

  it('drops points just inside the horizon, where a badge would hang off the edge', () => {
    // At altitude 1 the horizon is 60° out; 58° is inside it but within the margin.
    expect(facesCamera(0, 58, { lat: 0, lng: 0, altitude: 1 })).toBe(false);
    expect(facesCamera(0, 40, { lat: 0, lng: 0, altitude: 1 })).toBe(true);
  });
});

describe('countBadgeFill', () => {
  it('darkens an owner colour toward the board’s ink', () => {
    expect(countBadgeFill('#e74c3c')).toBe('rgb(125, 46, 41)');
    expect(countBadgeFill('#fff')).toBe('rgb(138, 139, 142)');
  });

  it('leaves anything that is not a hex colour alone', () => {
    expect(countBadgeFill('rebeccapurple')).toBe('rebeccapurple');
  });
});

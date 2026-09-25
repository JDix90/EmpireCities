import { describe, expect, it } from 'vitest';
import { isSameMap } from './mapResend';

function board() {
  return {
    map_id: 'era_space_age',
    territories: [
      { territory_id: 'a', name: 'A', polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0.5, 0.5] },
      { territory_id: 'b', name: 'B', polygon: [[2, 0], [3, 0], [3, 1]], center_point: [2.5, 0.5] },
    ],
    connections: [{ from: 'a', to: 'b', type: 'land' }],
  };
}

describe('isSameMap', () => {
  it('treats a resent copy of the same map as the same map', () => {
    // What a rejoin delivers: equal content, a new object from JSON.parse.
    expect(isSameMap(board(), JSON.parse(JSON.stringify(board())))).toBe(true);
  });

  it('sees a change anywhere in the map, connections included', () => {
    const lane = board();
    lane.connections.push({ from: 'b', to: 'a', type: 'sea' });
    expect(isSameMap(board(), lane)).toBe(false);

    const moved = board();
    moved.territories[1].polygon[0] = [2, 0.5];
    expect(isSameMap(board(), moved)).toBe(false);
  });

  it('never matches when the page has no map yet', () => {
    expect(isSameMap(null, board())).toBe(false);
    expect(isSameMap(undefined, board())).toBe(false);
  });
});

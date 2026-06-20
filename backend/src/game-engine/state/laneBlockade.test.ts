import { describe, it, expect } from 'vitest';
import type { GameState, GameMap } from '../../types';
import {
  orbitLaneId,
  isOrbitLane,
  isLaneSealedForPlayer,
  canSealLane,
  tickLaneBlockades,
} from './moonAccess';

const map = {
  connections: [
    { from: 'sol_a', to: 'verdan_a', type: 'orbit' },
    { from: 'sol_a', to: 'sol_b', type: 'land' },
  ],
} as unknown as GameMap;

function mkState(opts: {
  enabled?: boolean;
  blockades?: GameState['lane_blockades'];
  owners?: Record<string, string>;
}): GameState {
  const owners = opts.owners ?? { sol_a: 'p1', verdan_a: 'p2', sol_b: 'p1' };
  return {
    settings: { lanes_contestable_enabled: opts.enabled ?? true },
    lane_blockades: opts.blockades,
    territories: Object.fromEntries(Object.entries(owners).map(([id, o]) => [id, { owner_id: o }])),
  } as unknown as GameState;
}

describe('orbitLaneId / isOrbitLane', () => {
  it('is order-independent', () => {
    expect(orbitLaneId('b', 'a')).toBe(orbitLaneId('a', 'b'));
    expect(orbitLaneId('a', 'b')).toBe('a::b');
  });
  it('detects orbit edges only', () => {
    expect(isOrbitLane(map, 'sol_a', 'verdan_a')).toBe(true);
    expect(isOrbitLane(map, 'verdan_a', 'sol_a')).toBe(true);
    expect(isOrbitLane(map, 'sol_a', 'sol_b')).toBe(false); // land
  });
});

describe('isLaneSealedForPlayer', () => {
  const sealed = { [orbitLaneId('sol_a', 'verdan_a')]: { owner_id: 'p2', turns_remaining: 2 } };
  it('blocks players other than the sealer', () => {
    expect(isLaneSealedForPlayer(mkState({ blockades: sealed }), 'sol_a', 'verdan_a', 'p1')).toBe(true);
  });
  it('lets the sealer cross their own seal', () => {
    expect(isLaneSealedForPlayer(mkState({ blockades: sealed }), 'sol_a', 'verdan_a', 'p2')).toBe(false);
  });
  it('is a no-op when disabled, unsealed, or expired', () => {
    expect(isLaneSealedForPlayer(mkState({ blockades: sealed, enabled: false }), 'sol_a', 'verdan_a', 'p1')).toBe(false);
    expect(isLaneSealedForPlayer(mkState({}), 'sol_a', 'verdan_a', 'p1')).toBe(false);
    const expired = { [orbitLaneId('sol_a', 'verdan_a')]: { owner_id: 'p2', turns_remaining: 0 } };
    expect(isLaneSealedForPlayer(mkState({ blockades: expired }), 'sol_a', 'verdan_a', 'p1')).toBe(false);
  });
});

describe('canSealLane', () => {
  it('allows sealing a lane you hold an endpoint of', () => {
    const r = canSealLane(mkState({}), map, 'sol_a', 'verdan_a', 'p1');
    expect(r.ok).toBe(true);
    expect(r.laneId).toBe(orbitLaneId('sol_a', 'verdan_a'));
  });
  it('rejects when disabled, not an orbit lane, or you hold neither endpoint', () => {
    expect(canSealLane(mkState({ enabled: false }), map, 'sol_a', 'verdan_a', 'p1').ok).toBe(false);
    expect(canSealLane(mkState({}), map, 'sol_a', 'sol_b', 'p1').ok).toBe(false); // land edge
    expect(canSealLane(mkState({}), map, 'sol_a', 'verdan_a', 'p3').ok).toBe(false); // owns neither
  });
  it('rejects a lane a rival already sealed', () => {
    const sealed = { [orbitLaneId('sol_a', 'verdan_a')]: { owner_id: 'p2', turns_remaining: 2 } };
    expect(canSealLane(mkState({ blockades: sealed }), map, 'sol_a', 'verdan_a', 'p1').ok).toBe(false);
  });
  it('enforces one active seal per player', () => {
    const mine = { other_lane: { owner_id: 'p1', turns_remaining: 2 } };
    expect(canSealLane(mkState({ blockades: mine }), map, 'sol_a', 'verdan_a', 'p1').ok).toBe(false);
  });
});

describe('tickLaneBlockades', () => {
  it('decrements and drops expired seals', () => {
    const state = mkState({ blockades: { a: { owner_id: 'p1', turns_remaining: 2 }, b: { owner_id: 'p2', turns_remaining: 1 } } });
    tickLaneBlockades(state);
    expect(state.lane_blockades).toEqual({ a: { owner_id: 'p1', turns_remaining: 1 } });
    tickLaneBlockades(state);
    expect(state.lane_blockades).toEqual({});
  });
});

import { describe, it, expect } from 'vitest';
import type { GameState, GameMap } from '../../types';
import {
  orbitLaneId,
  isOrbitLane,
  isLaneSealedForPlayer,
  canSealLane,
  tickLaneBlockades,
  laneStateFor,
  orbitGatewayTerritoryIds,
  galaxyLaneAttackDiceCap,
  EMERGENCY_SEAL_ABILITY_ID,
  GALAXY_LANE_SEAL_DURATION,
} from './moonAccess';

const map = {
  territories: [
    { territory_id: 'sol_a', world_id: 'sol', region_id: 'r' },
    { territory_id: 'sol_b', world_id: 'sol', region_id: 'r' },
    { territory_id: 'verdan_a', world_id: 'verdan', region_id: 'r' },
    { territory_id: 'nexus_a', world_id: 'nexus_station', region_id: 'r' },
    { territory_id: 'rust_a', world_id: 'rust', region_id: 'r' },
  ],
  connections: [
    { from: 'sol_a', to: 'verdan_a', type: 'orbit' },
    { from: 'nexus_a', to: 'rust_a', type: 'orbit' },
    { from: 'sol_a', to: 'sol_b', type: 'land' },
  ],
} as unknown as GameMap;

function mkState(opts: {
  blockades?: GameState['lane_blockades'];
  owners?: Record<string, string>;
  corridors?: boolean;
  techs?: Record<string, string[]>;
}): GameState {
  const owners = opts.owners ?? { sol_a: 'p1', verdan_a: 'p2', sol_b: 'p1', nexus_a: 'p4', rust_a: 'p2' };
  const players = ['p1', 'p2', 'p4'].map((id) => ({
    player_id: id,
    unlocked_techs: opts.techs?.[id] ?? [],
  }));
  return {
    era: 'galaxy_age',
    settings: { galaxy_corridors_enabled: opts.corridors ?? true, tech_trees_enabled: true },
    lane_blockades: opts.blockades,
    players,
    territories: Object.fromEntries(Object.entries(owners).map(([id, o]) => [id, { owner_id: o }])),
  } as unknown as GameState;
}

describe('orbitLaneId / isOrbitLane / gateways', () => {
  it('is order-independent', () => {
    expect(orbitLaneId('b', 'a')).toBe(orbitLaneId('a', 'b'));
    expect(orbitLaneId('a', 'b')).toBe('a::b');
  });
  it('detects orbit edges only', () => {
    expect(isOrbitLane(map, 'sol_a', 'verdan_a')).toBe(true);
    expect(isOrbitLane(map, 'verdan_a', 'sol_a')).toBe(true);
    expect(isOrbitLane(map, 'sol_a', 'sol_b')).toBe(false); // land
  });
  it('lists both ends of every lane as gateways', () => {
    expect([...orbitGatewayTerritoryIds(map)].sort()).toEqual(['nexus_a', 'rust_a', 'sol_a', 'verdan_a']);
  });
});

describe('laneStateFor', () => {
  it('reads corridor / open / closed from the two gateways', () => {
    const state = mkState({ owners: { sol_a: 'p1', verdan_a: 'p1', nexus_a: 'p4', rust_a: 'p2' } });
    expect(laneStateFor(state, 'sol_a', 'verdan_a', 'p1')).toBe('corridor');
    expect(laneStateFor(state, 'sol_a', 'verdan_a', 'p2')).toBe('closed');
    expect(laneStateFor(state, 'nexus_a', 'rust_a', 'p4')).toBe('open');
    expect(laneStateFor(state, 'nexus_a', 'rust_a', 'p2')).toBe('open');
  });
});

describe('galaxyLaneAttackDiceCap', () => {
  it('caps a lane crossing at 2 dice, 3 with Lane Charts', () => {
    expect(galaxyLaneAttackDiceCap(mkState({}), 'p1')).toBe(2);
    expect(galaxyLaneAttackDiceCap(mkState({ techs: { p1: ['ga_hyperspace_chart'] } }), 'p1')).toBe(3);
  });
  it('applies no cap when corridors are off', () => {
    expect(galaxyLaneAttackDiceCap(mkState({ corridors: false }), 'p1')).toBeUndefined();
  });
});

describe('isLaneSealedForPlayer', () => {
  const sealed = { [orbitLaneId('sol_a', 'verdan_a')]: { owner_id: 'p2', turns_remaining: 1 } };
  it('blocks players other than the sealer', () => {
    expect(isLaneSealedForPlayer(mkState({ blockades: sealed }), 'sol_a', 'verdan_a', 'p1')).toBe(true);
  });
  it('lets the sealer cross their own seal', () => {
    expect(isLaneSealedForPlayer(mkState({ blockades: sealed }), 'sol_a', 'verdan_a', 'p2')).toBe(false);
  });
  it('is a no-op when unsealed or expired', () => {
    expect(isLaneSealedForPlayer(mkState({}), 'sol_a', 'verdan_a', 'p1')).toBe(false);
    const expired = { [orbitLaneId('sol_a', 'verdan_a')]: { owner_id: 'p2', turns_remaining: 0 } };
    expect(isLaneSealedForPlayer(mkState({ blockades: expired }), 'sol_a', 'verdan_a', 'p1')).toBe(false);
  });
});

describe('canSealLane — Emergency Seal', () => {
  it('lets the Custodians seal a lane touching Nexus Station', () => {
    const r = canSealLane(mkState({}), map, 'nexus_a', 'rust_a', 'p4', EMERGENCY_SEAL_ABILITY_ID);
    expect(r.ok).toBe(true);
    expect(r.laneId).toBe(orbitLaneId('nexus_a', 'rust_a'));
    expect(GALAXY_LANE_SEAL_DURATION).toBe(1);
  });
  it('refuses every other faction', () => {
    expect(canSealLane(mkState({}), map, 'nexus_a', 'rust_a', 'p1', 'cyber_attack').ok).toBe(false);
    expect(canSealLane(mkState({}), map, 'nexus_a', 'rust_a', 'p1', undefined).error).toMatch(/Void Custodians/);
  });
  it('refuses lanes that do not touch Nexus, and land edges', () => {
    expect(canSealLane(mkState({}), map, 'sol_a', 'verdan_a', 'p4', EMERGENCY_SEAL_ABILITY_ID).error)
      .toMatch(/touch Nexus Station/);
    expect(canSealLane(mkState({}), map, 'sol_a', 'sol_b', 'p4', EMERGENCY_SEAL_ABILITY_ID).ok).toBe(false);
  });
  it('refuses a lane a rival already sealed', () => {
    const sealed = { [orbitLaneId('nexus_a', 'rust_a')]: { owner_id: 'p2', turns_remaining: 1 } };
    expect(canSealLane(mkState({ blockades: sealed }), map, 'nexus_a', 'rust_a', 'p4', EMERGENCY_SEAL_ABILITY_ID).ok)
      .toBe(false);
  });
});

describe('tickLaneBlockades', () => {
  it('ages only the incoming player\'s seals, and drops them at zero', () => {
    const state = mkState({ blockades: { a: { owner_id: 'p1', turns_remaining: 2 }, b: { owner_id: 'p2', turns_remaining: 1 } } });
    tickLaneBlockades(state, 'p1');
    expect(state.lane_blockades).toEqual({
      a: { owner_id: 'p1', turns_remaining: 1 },
      b: { owner_id: 'p2', turns_remaining: 1 },
    });
    tickLaneBlockades(state, 'p2');
    expect(state.lane_blockades).toEqual({ a: { owner_id: 'p1', turns_remaining: 1 } });
    tickLaneBlockades(state, 'p1');
    expect(state.lane_blockades).toEqual({});
  });
});

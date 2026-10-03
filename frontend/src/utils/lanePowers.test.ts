/**
 * The territory panel offers a lane power only where the server would take it
 * (backend abilities/lanePowers.ts). Prices come from the shared table.
 */
import { describe, it, expect } from 'vitest';
import { GALAXY_LANE_POWER_COSTS } from '@borderfall/shared';
import { isLanePowerId, lanePowerApplies, lanePowerCost, ringGapLanes, type LanePowerContext } from './lanePowers';

function ctx(territoryId: string, territories: LanePowerContext['territories']): LanePowerContext {
  return {
    territoryId,
    myPlayerId: 'me',
    territories,
    connections: [
      { from: 'gate', to: 'far', type: 'orbit' },
      { from: 'gate', to: 'inland', type: 'land' },
      { from: 'jg_a', to: 'jg_b', type: 'orbit', source: 'jump_gate' },
    ],
  };
}

describe('lanePowerApplies', () => {
  it('Lance Battery: a rival across a lane from my gateway with a defence building', () => {
    const t = { gate: { owner_id: 'me', buildings: ['defense_1'] }, far: { owner_id: 'rival' }, inland: { owner_id: 'rival' } };
    expect(lanePowerApplies('lance_battery', ctx('far', t))).toBe(true);
    expect(lanePowerApplies('lance_battery', ctx('inland', t))).toBe(false);
    expect(lanePowerApplies('lance_battery', ctx('far', { ...t, gate: { owner_id: 'me', buildings: ['production_1'] } }))).toBe(false);
    expect(lanePowerApplies('lance_battery', ctx('far', { ...t, far: { owner_id: 'me' } }))).toBe(false);
  });

  it('Orbital Muster: a gateway of mine with an industry building, never an inland tile', () => {
    expect(lanePowerApplies('orbital_muster', ctx('gate', { gate: { owner_id: 'me', buildings: ['production_2'] } }))).toBe(true);
    expect(lanePowerApplies('orbital_muster', ctx('gate', { gate: { owner_id: 'me', buildings: ['defense_1'] } }))).toBe(false);
    expect(lanePowerApplies('orbital_muster', ctx('gate', { gate: { owner_id: 'rival', buildings: ['production_2'] } }))).toBe(false);
    expect(lanePowerApplies('orbital_muster', ctx('inland', { inland: { owner_id: 'me', buildings: ['production_2'] } }))).toBe(false);
    expect(lanePowerApplies('orbital_muster', ctx('jg_a', { jg_a: { owner_id: 'me', buildings: ['production_2'] } }))).toBe(false);
  });

  it('Seal Breaker: a gateway of mine with a defence building, never a Jump Gate end', () => {
    expect(lanePowerApplies('seal_breaker', ctx('gate', { gate: { owner_id: 'me', buildings: ['defense_1'] } }))).toBe(true);
    expect(lanePowerApplies('seal_breaker', ctx('inland', { inland: { owner_id: 'me', buildings: ['defense_1'] } }))).toBe(false);
    expect(lanePowerApplies('seal_breaker', ctx('jg_a', { jg_a: { owner_id: 'me', buildings: ['defense_1'] } }))).toBe(false);
  });

  /**
   * A three-world ring with one gap: A and B are joined, B and C are joined,
   * A and C are not, so the gap runs between A's and C's first gateways.
   */
  const RING: LanePowerContext['connections'] = [
    { from: 'a1', to: 'b1', type: 'orbit' },
    { from: 'b2', to: 'c2', type: 'orbit' },
    { from: 'a1', to: 'a_in', type: 'land' },
    { from: 'c1', to: 'c2', type: 'land' },
  ];
  const WORLDS = { a1: 'a', a_in: 'a', b1: 'b', b2: 'b', c1: 'c', c2: 'c', c_in: 'c' };

  it('finds the ring gap between the first gateways of two unjoined worlds', () => {
    expect(ringGapLanes(RING, WORLDS)).toEqual([{ from: 'a1', to: 'c2' }]);
    expect(ringGapLanes([...RING, { from: 'a1', to: 'c2', type: 'orbit' }], WORLDS)).toEqual([]);
  });

  it('Surge Projector: a rival gateway across a gap, from my end, with my Jump Gates on both worlds', () => {
    const t = {
      a1: { owner_id: 'me' },
      a_in: { owner_id: 'me', buildings: ['jump_gate'] },
      c_in: { owner_id: 'me', buildings: ['jump_gate'] },
      c2: { owner_id: 'rival' },
    };
    const surge = (territoryId: string, territories: LanePowerContext['territories'], connections = RING) =>
      lanePowerApplies('surge_projector', { territoryId, myPlayerId: 'me', territories, connections, worldOf: WORLDS });
    expect(surge('c2', t)).toBe(true);
    // No gate on the far world; my end lost; my own tile; a gap already bridged.
    expect(surge('c2', { ...t, c_in: { owner_id: 'me' } })).toBe(false);
    expect(surge('c2', { ...t, a1: { owner_id: 'rival' } })).toBe(false);
    expect(surge('a1', t)).toBe(false);
    expect(surge('c2', t, [...RING, { from: 'a1', to: 'c2', type: 'orbit', source: 'lane_surge' }])).toBe(false);
    // Without the map's worlds the panel offers nothing rather than guessing.
    expect(lanePowerApplies('surge_projector', { territoryId: 'c2', myPlayerId: 'me', territories: t, connections: RING })).toBe(false);
  });

  it('no other power reaches across a projected lane', () => {
    const t = { far: { owner_id: 'rival' }, gate: { owner_id: 'me', buildings: ['defense_1'] } };
    const projected = [{ from: 'gate', to: 'far', type: 'orbit', source: 'surge_projector' }];
    expect(lanePowerApplies('lance_battery', { territoryId: 'far', myPlayerId: 'me', territories: t, connections: projected })).toBe(false);
  });

  it('leaves every other ability alone', () => {
    expect(lanePowerApplies('blockade_runner', ctx('nowhere', {}))).toBe(true);
    expect(isLanePowerId('blockade_runner')).toBe(false);
  });

  it('quotes the shared price', () => {
    expect(lanePowerCost('lance_battery')).toBe(GALAXY_LANE_POWER_COSTS.lance_battery);
    expect(lanePowerCost('orbital_muster')).toBe(6);
    expect(lanePowerCost('surge_projector')).toBe(10);
    expect(lanePowerCost('dyson_beam')).toBeNull();
  });
});

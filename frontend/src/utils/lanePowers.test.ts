/**
 * The territory panel offers a lane power only where the server would take it
 * (backend abilities/lanePowers.ts). Prices come from the shared table.
 */
import { describe, it, expect } from 'vitest';
import { GALAXY_LANE_POWER_COSTS } from '@borderfall/shared';
import { isLanePowerId, lanePowerApplies, lanePowerCost, type LanePowerContext } from './lanePowers';

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

  it('leaves every other ability alone', () => {
    expect(lanePowerApplies('blockade_runner', ctx('nowhere', {}))).toBe(true);
    expect(isLanePowerId('blockade_runner')).toBe(false);
  });

  it('quotes the shared price', () => {
    expect(lanePowerCost('lance_battery')).toBe(GALAXY_LANE_POWER_COSTS.lance_battery);
    expect(lanePowerCost('orbital_muster')).toBe(6);
    expect(lanePowerCost('dyson_beam')).toBeNull();
  });
});

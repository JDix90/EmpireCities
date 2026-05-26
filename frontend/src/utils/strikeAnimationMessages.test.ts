import { describe, it, expect } from 'vitest';
import { getStrikeToastMessage } from './strikeAnimationMessages';

const baseEvent = {
  abilityId: 'nuclear_strike',
  attackerId: 'p1',
  attackerName: 'Alice',
  attackerColor: '#fff',
  territoryId: 't1',
  targetOwnerId: 'p2',
  targetOwnerName: 'Bob',
  unitReduction: 2,
};

describe('strikeAnimationMessages', () => {
  it('uses first-person copy for the attacker', () => {
    expect(getStrikeToastMessage(baseEvent, 'Berlin', { resolvedPlayerId: 'p1' }))
      .toContain('Your nuclear strike');
  });

  it('uses victim copy for the defender', () => {
    expect(getStrikeToastMessage(baseEvent, 'Berlin', { resolvedPlayerId: 'p2' }))
      .toContain('your territory');
  });

  it('uses observer copy for other players', () => {
    expect(getStrikeToastMessage(baseEvent, 'Berlin', { resolvedPlayerId: 'p3' }))
      .toContain('Alice nuclear strike on Berlin');
  });

  it('uses spectator copy when no viewer identity is provided', () => {
    expect(getStrikeToastMessage(baseEvent, 'Berlin', {}))
      .toContain('Alice nuclear strike on Berlin (Bob)');
  });

  it('uses orbital strike copy for attacker and victim', () => {
    const orbital = { ...baseEvent, abilityId: 'orbital_strike', unitReduction: 3 };
    expect(getStrikeToastMessage(orbital, 'Tokyo', { resolvedPlayerId: 'p1' }))
      .toContain('Your orbital strike');
    expect(getStrikeToastMessage(orbital, 'Tokyo', { resolvedPlayerId: 'p2' }))
      .toContain('your territory');
  });

    it('uses hypersonic strike observer copy', () => {
    const hypersonic = { ...baseEvent, abilityId: 'hypersonic_strike', unitReduction: 2 };
    expect(getStrikeToastMessage(hypersonic, 'Seoul', { resolvedPlayerId: 'p3' }))
      .toContain('Alice hypersonic strike on Seoul');
  });

  it('uses cyber attack victim copy', () => {
    const cyber = { ...baseEvent, abilityId: 'cyber_attack', unitReduction: 1 };
    expect(getStrikeToastMessage(cyber, 'Frankfurt', { resolvedPlayerId: 'p2' }))
      .toContain('your territory');
  });

  it('uses dyson beam attacker copy', () => {
    const dyson = { ...baseEvent, abilityId: 'dyson_beam', unitReduction: 4 };
    expect(getStrikeToastMessage(dyson, 'Nexus', { resolvedPlayerId: 'p1' }))
      .toContain('Your Dyson beam');
  });
});

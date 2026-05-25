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
      .toContain('Alice launched a nuclear strike');
  });

  it('uses spectator copy when no viewer identity is provided', () => {
    expect(getStrikeToastMessage(baseEvent, 'Berlin', {}))
      .toContain('Alice launched a nuclear strike on Berlin (Bob)');
  });
});

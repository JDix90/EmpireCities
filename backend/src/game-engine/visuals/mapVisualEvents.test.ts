import { describe, it, expect } from 'vitest';
import {
  buildCombatMapVisual,
  buildEventMapVisual,
  buildFortifyMapVisual,
  buildInfluenceMapVisual,
  buildNavalMapVisual,
  buildReinforceMapVisual,
  buildStrikeMapVisual,
} from './mapVisualEvents';
import type { GameState } from '../../types';

function minimalState(overrides?: Partial<GameState>): GameState {
  return {
    map_id: 'test',
    era: 'modern',
    phase: 'attack',
    turn_number: 1,
    current_player_index: 0,
    draft_units_remaining: 0,
    players: [
      { player_id: 'p1', username: 'Alice', color: '#e74c3c', is_ai: false, cards: [], territory_count: 1 },
      { player_id: 'p2', username: 'Bob', color: '#3498db', is_ai: false, cards: [], territory_count: 1 },
    ],
    territories: {
      t1: { territory_id: 't1', owner_id: 'p1', unit_count: 5 },
      t2: { territory_id: 't2', owner_id: 'p2', unit_count: 3 },
    },
    ...overrides,
  } as GameState;
}

describe('mapVisualEvents', () => {
  it('buildReinforceMapVisual includes player color and totals', () => {
    const state = minimalState();
    const evt = buildReinforceMapVisual({
      territoryId: 't1',
      units: 3,
      totalAfter: 8,
      playerId: 'p1',
      state,
    });
    expect(evt.kind).toBe('reinforce');
    expect(evt.units).toBe(3);
    expect(evt.totalAfter).toBe(8);
    expect(evt.playerColor).toBe('#e74c3c');
  });

  it('buildFortifyMapVisual wires from/to territories', () => {
    const state = minimalState();
    const evt = buildFortifyMapVisual({
      fromTerritoryId: 't1',
      toTerritoryId: 't2',
      units: 2,
      playerId: 'p1',
      state,
    });
    expect(evt.kind).toBe('fortify');
    expect(evt.fromTerritoryId).toBe('t1');
    expect(evt.territoryId).toBe('t2');
    expect(evt.playerColor).toBe('#e74c3c');
  });

  it('buildCombatMapVisual sets newOwnerColor on capture', () => {
    const state = minimalState();
    const evt = buildCombatMapVisual({
      fromId: 't1',
      toId: 't2',
      attackerId: 'p1',
      defenderId: 'p2',
      attackerLosses: 1,
      defenderLosses: 2,
      territoryCaptured: true,
      state,
    });
    expect(evt.kind).toBe('combat');
    expect(evt.captured).toBe(true);
    expect(evt.newOwnerColor).toBe('#e74c3c');
    expect(evt.defenderColor).toBe('#3498db');
  });

  it('buildStrikeMapVisual carries ability variant', () => {
    const evt = buildStrikeMapVisual({
      territoryId: 't2',
      abilityId: 'orbital_strike',
      attackerColor: '#e74c3c',
      unitReduction: 2,
    });
    expect(evt.kind).toBe('strike');
    expect(evt.variant).toBe('orbital_strike');
    expect(evt.unitReduction).toBe(2);
  });

  it('buildNavalMapVisual includes fleet losses and attacker color', () => {
    const state = minimalState();
    const evt = buildNavalMapVisual({
      fromId: 't1',
      toId: 't2',
      attackerId: 'p1',
      attackerLosses: 1,
      defenderLosses: 2,
      attackerWon: true,
      state,
    });
    expect(evt.kind).toBe('naval');
    expect(evt.attackerLosses).toBe(1);
    expect(evt.defenderLosses).toBe(2);
    expect(evt.captured).toBe(true);
    expect(evt.attackerColor).toBe('#e74c3c');
    expect(evt.defenderColor).toBe('#3498db');
  });

  it('buildInfluenceMapVisual sets seize colors from previous owner', () => {
    const state = minimalState();
    const evt = buildInfluenceMapVisual({
      targetId: 't2',
      actorId: 'p1',
      previousOwnerId: 'p2',
      variant: 'seize',
      state,
    });
    expect(evt.kind).toBe('influence');
    expect(evt.variant).toBe('seize');
    expect(evt.newOwnerColor).toBe('#e74c3c');
    expect(evt.defenderColor).toBe('#3498db');
    expect(evt.captured).toBe(true);
  });

  it('buildInfluenceMapVisual blocked variant omits capture colors', () => {
    const state = minimalState();
    const evt = buildInfluenceMapVisual({
      targetId: 't2',
      actorId: 'p1',
      previousOwnerId: 'p2',
      variant: 'blocked',
      state,
    });
    expect(evt.variant).toBe('blocked');
    expect(evt.captured).toBe(false);
    expect(evt.newOwnerColor).toBeUndefined();
  });

  it('buildEventMapVisual filters pseudo territory ids and carries deltas', () => {
    const evt = buildEventMapVisual({
      cardId: 'plague',
      effectType: 'region_disaster',
      global: true,
      affectedTerritories: [
        { territory_id: 't1', delta: -1 },
        { territory_id: '__draft_pool__', delta: 4 },
      ],
    });
    expect(evt.kind).toBe('event');
    expect(evt.global).toBe(true);
    expect(evt.variant).toBe('region_disaster');
    expect(evt.affectedTerritories).toEqual([{ territory_id: 't1', delta: -1 }]);
    expect(evt.territoryId).toBe('t1');
  });

  it('buildEventMapVisual includes regionId and draft bonus', () => {
    const evt = buildEventMapVisual({
      cardId: 'reinforcements',
      effectType: 'units_added',
      regionId: 'western_europe',
      draftUnitsGranted: 3,
    });
    expect(evt.regionId).toBe('western_europe');
    expect(evt.units).toBe(3);
    expect(evt.cardId).toBe('reinforcements');
  });
});

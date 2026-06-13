import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { getEraTechTree } from '../eras';
import {
  DEFAULT_ERA_SPINE_ID,
  ERA_ADVANCEMENT_SPINES,
  getMaxEraIndex,
  getSpineById,
  getSpineEraIdAtIndex,
  getStateSpineSteps,
  isValidSpineId,
} from './spines';

function stateWith(overrides: Partial<GameState>): GameState {
  return {
    settings: { era_advancement_enabled: true },
    ...overrides,
  } as GameState;
}

describe('spine registry', () => {
  it('every spine step references a defined era', () => {
    for (const spine of Object.values(ERA_ADVANCEMENT_SPINES)) {
      expect(spine.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of spine.steps) {
        expect(getEraTechTree(step.era_id).length, `${spine.spine_id}: ${step.era_id}`).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to the default spine for unknown ids', () => {
    expect(getSpineById('nope').spine_id).toBe(DEFAULT_ERA_SPINE_ID);
    expect(getSpineById(undefined).spine_id).toBe(DEFAULT_ERA_SPINE_ID);
    expect(isValidSpineId('poc')).toBe(true);
    expect(isValidSpineId('nope')).toBe(false);
  });
});

describe('getStateSpineSteps', () => {
  it('prefers the creation-time snapshot over the registry', () => {
    const state = stateWith({ era_spine: [{ era_id: 'ancient' }, { era_id: 'discovery' }] });
    expect(getStateSpineSteps(state).map((s) => s.era_id)).toEqual(['ancient', 'discovery']);
  });

  it('resolves from settings when no snapshot exists', () => {
    const state = stateWith({});
    expect(getStateSpineSteps(state).map((s) => s.era_id)).toEqual(['ancient', 'medieval']);
  });
});

describe('getSpineEraIdAtIndex', () => {
  it('clamps below zero and beyond the final step', () => {
    const state = stateWith({});
    expect(getSpineEraIdAtIndex(state, -1)).toBe('ancient');
    expect(getSpineEraIdAtIndex(state, 0)).toBe('ancient');
    expect(getSpineEraIdAtIndex(state, 1)).toBe('medieval');
    expect(getSpineEraIdAtIndex(state, 99)).toBe('medieval');
  });
});

describe('getMaxEraIndex', () => {
  it('is bounded by the spine even when the setting is larger', () => {
    const state = stateWith({
      settings: { era_advancement_enabled: true, era_advancement_max_era_index: 99 },
    } as Partial<GameState>);
    expect(getMaxEraIndex(state)).toBe(1);
  });

  it('lets the setting cap below the spine length', () => {
    const state = stateWith({
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }],
      settings: { era_advancement_enabled: true, era_advancement_max_era_index: 1 },
    } as Partial<GameState>);
    expect(getMaxEraIndex(state)).toBe(1);
  });

  it('defaults to the full spine when no setting is present', () => {
    const state = stateWith({
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }],
      settings: { era_advancement_enabled: true },
    } as Partial<GameState>);
    expect(getMaxEraIndex(state)).toBe(2);
  });
});

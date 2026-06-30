import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { getEraTechTree } from '../eras';
import type { PlayerState } from '../../types';
import {
  ASCENSION_ERA_ORDER,
  buildAscensionSpineFromEra,
  DEFAULT_ERA_SPINE_ID,
  ERA_ADVANCEMENT_SPINES,
  getCatchupGap,
  getEffectiveMilestoneGate,
  getEraLeaderIndex,
  getMaxEraIndex,
  getSpineById,
  getSpineEraIdAtIndex,
  getStateSpineSteps,
  isAscensionEra,
  isValidSpineId,
} from './spines';

function stateWith(overrides: Partial<GameState>): GameState {
  return {
    players: [],
    settings: { era_advancement_enabled: true },
    ...overrides,
  } as GameState;
}

function p(id: string, eraIndex: number, eliminated = false): PlayerState {
  return { player_id: id, current_era_index: eraIndex, is_eliminated: eliminated } as PlayerState;
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

  it('reaches Modern (index 5) on the classic spine', () => {
    const state = stateWith({
      era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
      settings: { era_advancement_enabled: true },
    } as Partial<GameState>);
    expect(getMaxEraIndex(state)).toBe(5);
    expect(getSpineEraIdAtIndex(state, 5)).toBe('modern');
  });
});

describe('classic spine shape', () => {
  it('runs Ancient → Modern with escalating per-step gates', () => {
    const ids = ERA_ADVANCEMENT_SPINES.classic.steps.map((s) => s.era_id);
    expect(ids).toEqual(['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern']);
    // later steps demand a tier-3 tech; earlier ones do not
    expect(ERA_ADVANCEMENT_SPINES.classic.steps[0].gate_overrides).toBeUndefined();
    expect(ERA_ADVANCEMENT_SPINES.classic.steps[3].gate_overrides?.min_tier3_techs).toBe(1);
  });
});

describe('full_ascension spine', () => {
  it('extends the classic timeline into the Space Age (index 6)', () => {
    const state = stateWith({
      era_spine: ERA_ADVANCEMENT_SPINES.full_ascension.steps,
      settings: { era_advancement_enabled: true },
    } as Partial<GameState>);
    expect(getMaxEraIndex(state)).toBe(6);
    expect(getSpineEraIdAtIndex(state, 6)).toBe('space_age');
  });

  it('grants the orbital_window signature on arriving in the Space Age', () => {
    expect(ERA_ADVANCEMENT_SPINES.full_ascension.steps[6]).toMatchObject({
      era_id: 'space_age',
      signature_id: 'orbital_window',
    });
    // modern is no longer terminal here, so it carries an exit gate
    expect(ERA_ADVANCEMENT_SPINES.full_ascension.steps[5].gate_overrides?.min_tier3_techs).toBe(1);
  });
});

describe('buildAscensionSpineFromEra (non-Ancient board-transform starts)', () => {
  it('mirrors full_ascension when started at Ancient', () => {
    const steps = buildAscensionSpineFromEra('ancient');
    expect(steps?.map((s) => s.era_id)).toEqual(ASCENSION_ERA_ORDER);
    expect(steps).toEqual(ERA_ADVANCEMENT_SPINES.full_ascension.steps);
  });

  it('slices from a mid-line era so the world climbs forward from the start map', () => {
    const steps = buildAscensionSpineFromEra('ww2');
    expect(steps?.map((s) => s.era_id)).toEqual(['ww2', 'coldwar', 'modern', 'space_age']);
  });

  it('keeps the start era exit gate but never relies on its arrival signature', () => {
    // ww2 is the start (index 0): its gate_overrides gate leaving ww2 and must
    // survive; later arrivals (index ≥ 1) carry the signatures that actually fire.
    const steps = buildAscensionSpineFromEra('ww2')!;
    expect(steps[0].gate_overrides?.min_tier3_techs).toBe(1);
    expect(steps[1]).toMatchObject({ era_id: 'coldwar', signature_id: 'intelligence_coup' });
  });

  it('reduces to a single terminal step when started at the Space Age', () => {
    const steps = buildAscensionSpineFromEra('space_age');
    expect(steps?.map((s) => s.era_id)).toEqual(['space_age']);
  });

  it('returns null for eras off the ascension line so callers fall back', () => {
    expect(buildAscensionSpineFromEra('acw' as never)).toBeNull();
    expect(buildAscensionSpineFromEra('galaxy' as never)).toBeNull();
  });

  it('clones steps so the snapshot never shares references with the registry', () => {
    const steps = buildAscensionSpineFromEra('medieval')!;
    const registryMedieval = ERA_ADVANCEMENT_SPINES.full_ascension.steps[1];
    expect(steps[0]).toEqual(registryMedieval);
    expect(steps[0]).not.toBe(registryMedieval);
  });

  it('isAscensionEra recognizes only on-line eras', () => {
    expect(isAscensionEra('ancient')).toBe(true);
    expect(isAscensionEra('modern')).toBe(true);
    expect(isAscensionEra('acw' as never)).toBe(false);
    expect(isAscensionEra(undefined)).toBe(false);
  });
});

describe('catch-up helpers', () => {
  it('reports the leader index from non-eliminated players', () => {
    const state = stateWith({ players: [p('a', 2), p('b', 4, true), p('c', 1)] });
    expect(getEraLeaderIndex(state)).toBe(2); // eliminated b (4) ignored
  });

  it('measures a player\'s gap behind the leader, floored at 0', () => {
    const state = stateWith({ players: [p('a', 3), p('b', 1)] });
    expect(getCatchupGap(state, state.players[0])).toBe(0); // leader
    expect(getCatchupGap(state, state.players[1])).toBe(2);
  });
});

describe('getEffectiveMilestoneGate', () => {
  function gateState(stepIndex: number, players: PlayerState[]): GameState {
    return stateWith({
      era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
      settings: { era_advancement_enabled: true },
      players,
    } as Partial<GameState>);
  }

  it('uses global defaults for an early step with no overrides', () => {
    const state = gateState(0, [p('a', 0)]);
    expect(getEffectiveMilestoneGate(state, 'a')).toEqual({
      min_tier1_techs: 3,
      min_tier2_techs: 1,
      min_tier3_techs: 0,
      min_buildings: 1,
    });
  });

  it('applies the spine step override (ww2: tier-3 required)', () => {
    const state = gateState(3, [p('a', 3)]);
    expect(getEffectiveMilestoneGate(state, 'a')).toEqual({
      min_tier1_techs: 3,
      min_tier2_techs: 2,
      min_tier3_techs: 1,
      min_buildings: 2,
    });
  });

  it('relaxes each requirement by one rank for a trailing player (tier-1 floored at 1)', () => {
    // player at ww2 step (index 3) but trailing a leader at coldwar (index 4)
    const state = gateState(3, [p('a', 3), p('leader', 4)]);
    expect(getEffectiveMilestoneGate(state, 'a')).toEqual({
      min_tier1_techs: 2,
      min_tier2_techs: 1,
      min_tier3_techs: 0,
      min_buildings: 1,
    });
  });

  it('scales the relaxation with the era gap (2 behind → relax 2 ranks)', () => {
    // ww2 step base gate is 3/2/1/2; a player 2 eras behind the leader relaxes by 2.
    const state = gateState(3, [p('a', 3), p('leader', 5)]);
    expect(getEffectiveMilestoneGate(state, 'a')).toEqual({
      min_tier1_techs: 1, // 3 - 2, floored at 1
      min_tier2_techs: 0, // 2 - 2
      min_tier3_techs: 0, // 1 - 2, floored at 0
      min_buildings: 0,   // 2 - 2
    });
  });
});

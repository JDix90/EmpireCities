import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { buildWorldModifierSnapshot, getWorldModifier, applyWorldBuildCost } from './worldModifiers';

function stateWith(mods?: Record<string, Record<string, number>>): GameState {
  return { settings: { world_modifiers: mods } } as unknown as GameState;
}

describe('buildWorldModifierSnapshot', () => {
  const map = {
    worlds: [
      { world_id: 'sol', modifiers: { production_bonus: 0.3 } },
      { world_id: 'verdan', modifiers: {} }, // empty → skipped
      { world_id: 'rust', modifiers: { build_cost_mult: 0.8 } },
      { world_id: 'nexus_station' }, // no modifiers → skipped
    ],
  };

  it('collects only worlds that define non-empty modifiers', () => {
    const snap = buildWorldModifierSnapshot(map, true);
    expect(snap).toEqual({ sol: { production_bonus: 0.3 }, rust: { build_cost_mult: 0.8 } });
  });

  it('returns undefined when disabled', () => {
    expect(buildWorldModifierSnapshot(map, false)).toBeUndefined();
  });

  it('returns undefined when no world defines modifiers', () => {
    expect(buildWorldModifierSnapshot({ worlds: [{ world_id: 'a' }, { world_id: 'b', modifiers: {} }] }, true)).toBeUndefined();
    expect(buildWorldModifierSnapshot({}, true)).toBeUndefined();
  });
});

describe('getWorldModifier', () => {
  const state = stateWith({ rust: { production_bonus: 0.4, build_cost_mult: 0.8 } });

  it('returns the modifiers for a known world', () => {
    expect(getWorldModifier(state, 'rust')).toEqual({ production_bonus: 0.4, build_cost_mult: 0.8 });
  });

  it('returns an empty object for unknown / missing world or when feature is off', () => {
    expect(getWorldModifier(state, 'sol')).toEqual({});
    expect(getWorldModifier(state, undefined)).toEqual({});
    expect(getWorldModifier(stateWith(undefined), 'rust')).toEqual({});
  });
});

describe('applyWorldBuildCost', () => {
  const state = stateWith({ rust: { build_cost_mult: 0.8 }, verdan: { build_cost_mult: 1 } });

  it('applies the multiplier with a ceil and floor of 0', () => {
    expect(applyWorldBuildCost(state, 'rust', 10)).toBe(8); // 10 * 0.8
    expect(applyWorldBuildCost(state, 'rust', 7)).toBe(6); // ceil(5.6)
  });

  it('is a no-op when mult is absent, 1, or world has no modifier', () => {
    expect(applyWorldBuildCost(state, 'verdan', 10)).toBe(10);
    expect(applyWorldBuildCost(state, 'sol', 10)).toBe(10);
    expect(applyWorldBuildCost(state, undefined, 10)).toBe(10);
  });
});

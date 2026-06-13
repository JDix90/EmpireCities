import { describe, it, expect } from 'vitest';
import type { GameSettings } from '../../types';
import { applyEraAdvancementPreset, getEraAdvancementPresetBundle, isEraAdvancementPreset } from './presets';
import { normalizeGameSettings } from '../state/gameSettings';

describe('preset helpers', () => {
  it('validates preset ids', () => {
    expect(isEraAdvancementPreset('skirmish')).toBe(true);
    expect(isEraAdvancementPreset('custom')).toBe(true);
    expect(isEraAdvancementPreset('nope')).toBe(false);
    expect(isEraAdvancementPreset(undefined)).toBe(false);
  });

  it('returns an empty bundle for custom/unknown', () => {
    expect(getEraAdvancementPresetBundle('custom')).toEqual({});
    expect(getEraAdvancementPresetBundle('nope')).toEqual({});
  });
});

describe('applyEraAdvancementPreset', () => {
  it('fills concrete settings from the preset bundle', () => {
    const merged = applyEraAdvancementPreset({ era_advancement_preset: 'skirmish' } as Partial<GameSettings>);
    expect(merged.era_advancement_spine_id).toBe('poc');
    expect(merged.era_advancement_cost_mult).toBe(1.6);
    expect(merged.era_advancement_min_tier1_techs).toBe(2);
  });

  it('lets an explicit setting override the preset', () => {
    const merged = applyEraAdvancementPreset({
      era_advancement_preset: 'skirmish',
      era_advancement_cost_mult: 3.0,
    } as Partial<GameSettings>);
    expect(merged.era_advancement_cost_mult).toBe(3.0); // explicit wins
    expect(merged.era_advancement_spine_id).toBe('poc'); // bundle fills the rest
  });

  it('passes raw through unchanged for custom/no preset', () => {
    const raw = { era_advancement_preset: 'custom', era_advancement_cost_mult: 2.5 } as Partial<GameSettings>;
    expect(applyEraAdvancementPreset(raw)).toBe(raw);
  });
});

describe('normalizeGameSettings — preset resolution', () => {
  const base = { era_advancement_enabled: true, economy_enabled: true, tech_trees_enabled: true };

  it('standard preset resolves the classic spine', () => {
    const s = normalizeGameSettings({ ...base, era_advancement_preset: 'standard' } as Partial<GameSettings>);
    expect(s.era_advancement_preset).toBe('standard');
    expect(s.era_advancement_spine_id).toBe('classic');
  });

  it('skirmish preset resolves the poc spine and its tuning', () => {
    const s = normalizeGameSettings({ ...base, era_advancement_preset: 'skirmish' } as Partial<GameSettings>);
    expect(s.era_advancement_spine_id).toBe('poc');
    expect(s.era_advancement_cost_mult).toBe(1.6);
    expect(s.era_advancement_min_tier1_techs).toBe(2);
    expect(s.era_advancement_stability_gate).toBe(50);
  });

  it('epic preset resolves the classic spine with steeper tuning', () => {
    const s = normalizeGameSettings({ ...base, era_advancement_preset: 'epic' } as Partial<GameSettings>);
    expect(s.era_advancement_spine_id).toBe('classic');
    expect(s.era_advancement_cost_mult).toBe(2.2);
    expect(s.era_advancement_stability_gate).toBe(65);
  });

  it('an explicit knob overrides the preset bundle', () => {
    const s = normalizeGameSettings({
      ...base,
      era_advancement_preset: 'skirmish',
      era_advancement_cost_mult: 3.3,
    } as Partial<GameSettings>);
    expect(s.era_advancement_cost_mult).toBe(3.3);
    expect(s.era_advancement_spine_id).toBe('poc');
  });

  it('drops the preset when era advancement is disabled', () => {
    const s = normalizeGameSettings({ era_advancement_enabled: false, era_advancement_preset: 'epic' } as Partial<GameSettings>);
    expect(s.era_advancement_preset).toBeUndefined();
    expect(s.era_advancement_spine_id).toBeUndefined();
  });
});

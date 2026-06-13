import type { GameSettings } from '../../types';

/**
 * Era advancement lobby presets — named bundles of `era_advancement_*` settings
 * so players pick a feel ("Skirmish", "Standard", "Epic") instead of ~25 raw
 * knobs. Resolved server-side in `normalizeGameSettings`: a preset's values fill
 * in, but any explicit setting the lobby sends (Custom power-users) wins.
 *
 * The resolved concrete settings are what gets snapshotted into the game, so
 * changing a preset definition never affects in-flight games.
 */
export type EraAdvancementPreset = 'skirmish' | 'standard' | 'epic' | 'custom';

const PRESET_BUNDLES: Record<'skirmish' | 'standard' | 'epic', Partial<GameSettings>> = {
  // Short, forgiving climb on the 2-era PoC spine — quick live games.
  skirmish: {
    era_advancement_spine_id: 'poc',
    era_advancement_cost_mult: 1.6,
    era_advancement_min_tier1_techs: 2,
    era_advancement_min_buildings: 1,
    era_advancement_stability_gate: 50,
  },
  // The default: full classic spine (Ancient → Modern) with balanced tuning.
  standard: {
    era_advancement_spine_id: 'classic',
  },
  // The full Ascension spine (Ancient → Space Age) with steeper costs and a
  // stricter stability gate — long / async marathons.
  epic: {
    era_advancement_spine_id: 'full_ascension',
    era_advancement_cost_mult: 2.2,
    era_advancement_stability_gate: 65,
  },
};

export const ERA_ADVANCEMENT_PRESET_IDS: EraAdvancementPreset[] = ['skirmish', 'standard', 'epic', 'custom'];
export const DEFAULT_ERA_ADVANCEMENT_PRESET: EraAdvancementPreset = 'standard';

export function isEraAdvancementPreset(value: unknown): value is EraAdvancementPreset {
  return typeof value === 'string' && (ERA_ADVANCEMENT_PRESET_IDS as string[]).includes(value);
}

/** Concrete settings bundle for a preset (empty for 'custom' / unknown). */
export function getEraAdvancementPresetBundle(preset: unknown): Partial<GameSettings> {
  if (preset === 'skirmish' || preset === 'standard' || preset === 'epic') {
    return PRESET_BUNDLES[preset];
  }
  return {};
}

/**
 * Merge a preset bundle under the raw settings: bundle fills gaps, explicit raw
 * `era_advancement_*` values override. Non-era keys pass through unchanged.
 * Skips `undefined` raw values so an absent knob doesn't clobber the bundle.
 */
export function applyEraAdvancementPreset(raw: Partial<GameSettings>): Partial<GameSettings> {
  const bundle = getEraAdvancementPresetBundle(raw.era_advancement_preset);
  if (Object.keys(bundle).length === 0) return raw;
  const merged: Record<string, unknown> = { ...bundle };
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as Partial<GameSettings>;
}

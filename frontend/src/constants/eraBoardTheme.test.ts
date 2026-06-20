import { describe, it, expect } from 'vitest';
import { eraBoardTheme } from './eraBoardTheme';
import { ERA_META } from './eraMeta';

describe('eraBoardTheme', () => {
  it('maps each built-in era to a distinct atmosphere + accent', () => {
    const eras = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'space_age', 'galaxy_age'];
    const themes = eras.map((e) => eraBoardTheme(e));
    // Every era resolves a non-fallback id, a hex background, an accent, and a glyph.
    for (const t of themes) {
      expect(t.eraId).not.toBe('');
      expect(t.background).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(t.glyph.length).toBeGreaterThan(0);
    }
    // Atmospheres are actually distinct across eras (the whole point of the re-skin).
    const backgrounds = new Set(themes.map((t) => t.background));
    expect(backgrounds.size).toBe(eras.length);
  });

  it('accent matches ERA_META so it stays in sync with the timeline/ceremony', () => {
    expect(eraBoardTheme('modern').accent).toBe(ERA_META.modern.color);
    expect(eraBoardTheme('ancient').accent).toBe(ERA_META.ancient.color);
  });

  it('falls back safely for missing / unknown / null ids (callers pass raw era ids)', () => {
    expect(eraBoardTheme(undefined).eraId).toBe('');
    expect(eraBoardTheme(null).background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(eraBoardTheme('not_a_real_era').eraId).toBe('not_a_real_era');
    expect(eraBoardTheme('not_a_real_era').background).toBe('#0a0e1a');
  });

  it('globe texture hook is wired for eras with a shipped asset, null otherwise', () => {
    // space_age ships a real (NASA public-domain) night-lights texture.
    expect(eraBoardTheme('space_age').globeTextureUrl).toBe('/globe/era/space_age.jpg');
    // Eras without a shipped asset stay null → globe keeps its default Earth.
    expect(eraBoardTheme('ancient').globeTextureUrl).toBeNull();
    expect(eraBoardTheme('modern').globeTextureUrl).toBeNull();
    // The 2D terrain hook is still unused (Layer 2, later).
    expect(eraBoardTheme('space_age').terrainTextureUrl).toBeNull();
  });
});

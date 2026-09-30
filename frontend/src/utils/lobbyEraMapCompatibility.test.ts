import { describe, it, expect } from 'vitest';
import { GALAXY_PLAYER_COUNT_ERROR, evaluateEraMapCompatibility } from './lobbyEraMapCompatibility';

const hasCustomPairingNote = (warnings: Array<{ message: string }>) =>
  warnings.some((w) => w.message.startsWith('Custom pairing'));

/**
 * Regression guard: the warning condition used to compare the ERA id against
 * its MAP id ('ancient' !== 'era_ancient', true for every era), so every game
 * — including the defaults a brand-new player creates — carried a "Custom
 * pairing" note implying they had configured something nonstandard.
 */
describe('evaluateEraMapCompatibility — custom pairing note', () => {
  it('does NOT warn for an era on its own bundled map', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ancient',
      map_id: 'era_ancient',
      settings: {},
    });
    expect(result.allowed).toBe(true);
    expect(hasCustomPairingNote(result.warnings)).toBe(false);
  });

  it('warns when rules era and theater map genuinely differ', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_ancient',
      settings: {},
    });
    expect(hasCustomPairingNote(result.warnings)).toBe(true);
  });
});

describe('evaluateEraMapCompatibility — Galactic Age factions', () => {
  const galaxy = (settings: Record<string, unknown>) =>
    evaluateEraMapCompatibility({ era_id: 'galaxy_age', map_id: 'era_galaxy', settings, is_admin: true, player_count: 4 });

  it('blocks the home-world game without factions', () => {
    expect(galaxy({}).hardBlock).toMatch(/Asymmetric Factions/);
  });

  it('allows factions off when Home Worlds is off (plain lanes)', () => {
    expect(galaxy({ galaxy_plain_lanes: true }).hardBlock).toBeNull();
    expect(galaxy({ factions_enabled: true }).hardBlock).toBeNull();
  });
});

describe('evaluateEraMapCompatibility — Galactic Age seats', () => {
  const seats = (player_count: number) =>
    evaluateEraMapCompatibility({
      era_id: 'galaxy_age', map_id: 'era_galaxy', settings: { factions_enabled: true }, is_admin: true, player_count,
    });

  it('lets the form fill up to four seats — the rest are for humans to take', () => {
    for (const n of [1, 2, 3, 4]) expect(seats(n).hardBlock).toBeNull();
  });

  it('refuses a fifth before the form is sent', () => {
    expect(seats(5).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
    expect(seats(8).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
  });
});

import { describe, it, expect } from 'vitest';
import { GALAXY_PLAYER_COUNT_ERROR, evaluateEraMapCompatibility, seatsPerFaction } from './lobbyEraMapCompatibility';

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
  const seats = (player_count: number, max_players?: number) =>
    evaluateEraMapCompatibility({
      era_id: 'galaxy_age', map_id: 'era_galaxy', settings: { factions_enabled: true }, is_admin: true, player_count,
      ...(max_players !== undefined ? { max_players } : {}),
    });

  it('lets the form fill up to four seats — the rest are for humans to take', () => {
    for (const n of [1, 2, 3, 4]) expect(seats(n).hardBlock).toBeNull();
    for (const n of [1, 2, 3, 4]) expect(seats(n, 4).hardBlock).toBeNull();
  });

  it('refuses a fifth before the form is sent', () => {
    expect(seats(5).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
    expect(seats(8).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
    expect(seats(5, 4).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
  });

  it('lets a Schism form fill up to eight', () => {
    for (const n of [1, 4, 5, 8]) expect(seats(n, 8).hardBlock).toBeNull();
  });

  it('refuses a seat cap the era does not play', () => {
    for (const cap of [5, 6, 7]) expect(seats(1, cap).hardBlock).toBe(GALAXY_PLAYER_COUNT_ERROR);
  });
});

describe('seatsPerFaction', () => {
  it('lets two seats share a faction in a Schism lobby, and one anywhere else', () => {
    expect(seatsPerFaction('galaxy_age', 'era_galaxy', { max_players: 8 })).toBe(2);
    expect(seatsPerFaction('custom', 'era_galaxy', { max_players: 8 })).toBe(2);
    expect(seatsPerFaction('galaxy_age', 'era_galaxy', { max_players: 4 })).toBe(1);
    expect(seatsPerFaction('ww2', 'era_ww2', { max_players: 8 })).toBe(1);
  });
});

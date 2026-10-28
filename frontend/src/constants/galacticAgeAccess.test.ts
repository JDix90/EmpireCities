/**
 * Who may play the Galactic Age, and what its pickers call it. While the open
 * beta is on (`galaxy_age_beta_enabled`) every signed-in player may, guests
 * included; otherwise only an admin. Space to Stars stays an admin's.
 */
import { describe, it, expect } from 'vitest';
import {
  canAccessGalacticAge,
  canAccessSpaceToStars,
  galacticAgeLabel,
  isGalacticAgeGame,
  withGalacticAgeLabel,
} from './galacticAgeAccess';

const admin = { is_admin: true, is_guest: false };
const player = { is_admin: false, is_guest: false };
const guest = { is_admin: false, is_guest: true };

describe('Galactic Age access', () => {
  it('is an admin’s while the beta is off', () => {
    expect(canAccessGalacticAge(admin)).toBe(true);
    expect(canAccessGalacticAge(player)).toBe(false);
    expect(canAccessGalacticAge(guest)).toBe(false);
  });

  it('is every signed-in player’s, guests included, while the beta is on', () => {
    expect(canAccessGalacticAge(player, true)).toBe(true);
    expect(canAccessGalacticAge(guest, true)).toBe(true);
    expect(canAccessGalacticAge(null, true)).toBe(false);
  });

  it('keeps Space to Stars an admin’s', () => {
    expect(canAccessSpaceToStars(admin)).toBe(true);
    expect(canAccessSpaceToStars(player)).toBe(false);
  });

  it('names the era Beta while the beta is on, and Coming Soon while it is off', () => {
    expect(galacticAgeLabel(true)).toBe('Galactic Age · Beta');
    expect(galacticAgeLabel(false)).toBe('Galactic Age — Coming Soon');
    expect(withGalacticAgeLabel('era_galaxy', 'Galactic Age — Coming Soon', true)).toBe('Galactic Age · Beta');
    expect(withGalacticAgeLabel('ww2', 'World War II', true)).toBe('World War II');
  });

  it('knows a Galactic Age game by its era or its board', () => {
    expect(isGalacticAgeGame('galaxy_age', 'era_galaxy')).toBe(true);
    expect(isGalacticAgeGame('custom', 'era_galaxy')).toBe(true);
    expect(isGalacticAgeGame('space_age', 'era_ascension_galaxy')).toBe(false);
  });
});

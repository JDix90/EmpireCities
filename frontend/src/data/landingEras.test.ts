import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_ERAS } from './landingEras';

/**
 * The Galactic Age card is generated from nothing: its numbers are typed by hand
 * next to a map that a generator rewrites. It said 12 territories and 2–4
 * players long after the board became four 16-tile worlds that only start with
 * exactly four seats (GALAXY_REQUIRED_PLAYERS).
 */
describe('landing era cards', () => {
  it('quotes the Galactic Age board as it is built', () => {
    const galaxy = LANDING_ERAS.find((e) => e.id === 'galaxy_age');
    expect(galaxy).toBeDefined();
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../public/maps/regional/era_galaxy.json'), 'utf8'),
    ) as { territories: unknown[] };
    expect(galaxy!.territoryCount).toBe(map.territories.length);
    expect(galaxy!.playersRange).toBe('4');
  });
});

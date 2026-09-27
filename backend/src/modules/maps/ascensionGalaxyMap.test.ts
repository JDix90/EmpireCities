/**
 * The committed Space to Stars board must be exactly what its two sources build.
 *
 * `era_ascension_galaxy.json` is derived from `era_space_age.json` and
 * `era_galaxy.json`. Before this test existed it had already drifted: a region
 * edit to the Space Age map (the Malay Archipelago moving to Oceania) never
 * reached this board, because nothing re-ran the builder.
 *
 * Comparing BYTES is deliberate: a test that re-derived and compared values
 * could pass while the committed file was wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASCENSION_EXO_WORLDS, GALAXY_UNLOCK_INDEX, MOON_LANES,
  ascensionWorldOf, buildAscensionGalaxyMap, renderAscensionGalaxyMap,
} from './ascensionGalaxyMap';
import { ASCENSION_OUTPUT_PATH, readSourceMap } from '../../../scripts/buildAscensionGalaxyMap';

const spaceAge = readSourceMap('era_space_age.json');
const galaxy = readSourceMap('era_galaxy.json');
const built = buildAscensionGalaxyMap(spaceAge, galaxy);

describe('Space to Stars board', () => {
  it('matches the committed file', () => {
    const committed = readFileSync(ASCENSION_OUTPUT_PATH, 'utf8');
    expect(
      committed === renderAscensionGalaxyMap(built)
        ? true
        : 'stale — run: pnpm -C backend exec tsx scripts/buildAscensionGalaxyMap.ts',
    ).toBe(true);
  });

  it('keeps every Earth and Moon tile in its Space Age region', () => {
    const source = new Map(spaceAge.territories.map((t) => [t.territory_id, t.region_id]));
    for (const t of built.territories) {
      if (!source.has(t.territory_id)) continue;
      expect(t.region_id, t.territory_id).toBe(source.get(t.territory_id));
    }
    expect(built.territories.filter((t) => source.has(t.territory_id))).toHaveLength(spaceAge.territories.length);
  });

  it('brings the far worlds across whole, locked until the Galactic Age', () => {
    const exo = new Set<string>(ASCENSION_EXO_WORLDS);
    const galaxyExo = galaxy.territories.filter((t) => exo.has(t.world_id ?? ''));
    const builtExo = built.territories.filter((t) => exo.has(ascensionWorldOf(t)));
    expect(builtExo.map((t) => t.territory_id)).toEqual(galaxyExo.map((t) => t.territory_id));
    for (const t of builtExo) {
      expect((t as { unlock_era_index?: number }).unlock_era_index, t.territory_id).toBe(GALAXY_UNLOCK_INDEX);
    }
  });

  it('puts the Moon in Sol\'s place on the ring', () => {
    for (const { moon, exo } of MOON_LANES) {
      expect(
        built.connections.some((c) => c.type === 'orbit' && c.from === moon && c.to === exo),
        `${moon}–${exo}`,
      ).toBe(true);
    }
    const ids = new Set(built.territories.map((t) => t.territory_id));
    for (const c of built.connections) {
      expect(ids.has(c.from) && ids.has(c.to), `${c.from}–${c.to}`).toBe(true);
    }
  });

  it('rejects a Moon lane to a tile that does not exist', () => {
    const broken = { ...galaxy, territories: galaxy.territories.filter((t) => t.territory_id !== MOON_LANES[0].exo) };
    expect(() => buildAscensionGalaxyMap(spaceAge, broken)).toThrow(/is not a far-world territory/);
  });
});

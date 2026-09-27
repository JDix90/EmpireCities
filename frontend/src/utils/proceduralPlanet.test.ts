import { describe, it, expect } from 'vitest';
import {
  planetProfileFor,
  planetKindFor,
  proceduralWorldFallbackColor,
  vnoise,
  fbm,
  colorize,
  colorizeLand,
  colorizeOcean,
  fillEquirectRGBA,
  verdanSea,
  rustSea,
  nexusVoid,
  neutralLandColorFor,
  rustRiftDistance,
  type PlanetKind,
} from './proceduralPlanet';

describe('planet profiles', () => {
  it('maps each galaxy world to its intended identity', () => {
    expect(planetKindFor('sol')).toBe('ocean');
    expect(planetKindFor('verdan')).toBe('verdant');
    expect(planetKindFor('rust')).toBe('desert');
    expect(planetKindFor('nexus_station')).toBe('city');
  });

  it('falls back to a neutral rocky world for unknown / empty ids', () => {
    expect(planetKindFor('some_future_world')).toBe('rocky');
    expect(planetKindFor('')).toBe('rocky');
    expect(planetKindFor(null)).toBe('rocky');
    expect(planetKindFor(undefined)).toBe('rocky');
  });

  it('exposes a hex fallback colour for every world', () => {
    for (const id of ['sol', 'verdan', 'rust', 'nexus_station', 'unknown']) {
      expect(proceduralWorldFallbackColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gives distinct seeds so worlds do not regenerate identically', () => {
    const seeds = ['sol', 'verdan', 'rust', 'nexus_station'].map((id) => planetProfileFor(id).seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('value noise', () => {
  it('is deterministic for identical inputs', () => {
    expect(vnoise(0.31, 0.62, 8, 1207)).toBe(vnoise(0.31, 0.62, 8, 1207));
    expect(fbm(0.4, 0.5, 5, 6, 99)).toBe(fbm(0.4, 0.5, 5, 6, 99));
  });

  it('stays within [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const u = (i * 0.019) % 1;
      const v = (i * 0.037) % 1;
      const n = fbm(u, v, 5, 6, 7711);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('wraps seamlessly in longitude (no antimeridian seam)', () => {
    for (const v of [0.1, 0.4, 0.73, 0.95]) {
      expect(vnoise(0, v, 12, 4404)).toBeCloseTo(vnoise(1, v, 12, 4404), 10);
      expect(fbm(0, v, 5, 6, 4404)).toBeCloseTo(fbm(1, v, 5, 6, 4404), 10);
    }
  });
});

describe('colorize', () => {
  const kinds: PlanetKind[] = ['ocean', 'verdant', 'desert', 'city', 'rocky'];

  it('returns in-gamut RGB for every kind across the sphere', () => {
    for (const kind of kinds) {
      for (let i = 0; i < 40; i++) {
        const u = (i * 0.025) % 1;
        const v = (i * 0.024) % 1;
        const c = colorize(kind, u, v, 1234);
        expect(c).toHaveLength(3);
        for (const ch of c) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('produces visibly different surfaces per world kind', () => {
    const sample = (kind: PlanetKind) => colorize(kind, 0.5, 0.5, 1000);
    const ocean = sample('ocean');
    const desert = sample('desert');
    const verdantLand = colorizeLand('verdant', 0.5, 0.5, 1000);
    // Desert should be warmer (more red than blue); ocean cooler; Verdan's canopy green.
    expect(desert[0]).toBeGreaterThan(desert[2]);
    expect(ocean[2]).toBeGreaterThanOrEqual(ocean[0]);
    expect(verdantLand[1]).toBeGreaterThan(verdantLand[0]);
  });
});

describe('fillEquirectRGBA', () => {
  it('fills a fully-opaque RGBA buffer of the right size', () => {
    const w = 8;
    const h = 4;
    const buf = new Uint8ClampedArray(w * h * 4);
    fillEquirectRGBA(buf, w, h, planetProfileFor('rust'));
    expect(buf.length).toBe(w * h * 4);
    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    }
    // Not all-black: at least one colour channel is set somewhere.
    expect(buf.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
  });
});

describe('territory-aligned land/ocean colorizers', () => {
  const kinds: PlanetKind[] = ['ocean', 'verdant', 'desert', 'city', 'rocky'];

  it('returns in-gamut RGB for every kind', () => {
    for (const kind of kinds) {
      for (let i = 0; i < 30; i++) {
        const u = (i * 0.031) % 1;
        const v = (i * 0.027) % 1;
        for (const c of [colorizeLand(kind, u, v, 99), colorizeOcean(kind, u, v, 99)]) {
          expect(c).toHaveLength(3);
          for (const ch of c) {
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
          }
        }
      }
    }
  });

  it('makes land clearly brighter than ocean/void on every world but Verdan', () => {
    const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    // Verdan's day-side sea is the white-hot Brilliance: see its own test below.
    for (const kind of kinds.filter((k) => k !== 'verdant')) {
      let landSum = 0;
      let oceanSum = 0;
      for (let i = 0; i < 60; i++) {
        const u = (i * 0.017) % 1;
        const v = 0.2 + ((i * 0.013) % 0.6); // avoid poles
        landSum += lum(colorizeLand(kind, u, v, 1234));
        oceanSum += lum(colorizeOcean(kind, u, v, 1234));
      }
      // Territories (land) should read lighter than the void/water between them.
      expect(landSum).toBeGreaterThan(oceanSum);
    }
  });
});

describe("Verdan's sea (tidally locked)", () => {
  // u/v for a lng/lat: u = (lng + 180) / 360, v = (90 - lat) / 180.
  const at = (lng: number, lat: number) => verdanSea((lng + 180) / 360, (90 - lat) / 180, 4404);
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  it('burns gold on the day side, goes teal in the twilight and black on the night side', () => {
    const day = at(30, 40); // ~20° from the substellar point [0, 50]
    const twilight = at(0, -32); // ~82°: the ring
    const night = at(180, -50); // the antistellar point
    expect(day[0]).toBeGreaterThan(day[2]); // gold, not blue
    expect(twilight[1]).toBeGreaterThan(twilight[0]); // teal
    expect(twilight[2]).toBeGreaterThan(twilight[0]);
    expect(lum(day)).toBeGreaterThan(lum(twilight));
    expect(lum(twilight)).toBeGreaterThan(lum(night));
  });

  it('follows the terminator, not the poles', () => {
    // The north pole is only 40° from the substellar point: Brilliance, not ice.
    const pole = at(0, 89.9);
    expect(pole[0]).toBeGreaterThan(pole[2]);
    expect(lum(pole)).toBeGreaterThan(150);
  });

  it('stays in gamut everywhere', () => {
    for (let lng = -180; lng < 180; lng += 15) {
      for (let lat = -85; lat <= 85; lat += 10) {
        for (const ch of at(lng, lat)) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe("the Rust Belt's sea", () => {
  const at = (lng: number, lat: number) => rustSea((lng + 180) / 360, (90 - lat) / 180, 7711);
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  it('measures distance to the Marineris Rift', () => {
    expect(rustRiftDistance(-72, -8)).toBeLessThan(1.5); // a rift vertex
    expect(rustRiftDistance(130, 10)).toBeGreaterThan(90); // the far side
  });

  it('glows molten along the rift and stays dark slag elsewhere', () => {
    const rift = at(-58, -16); // the rift lake
    const ocean = at(130, 10); // the Oxide Ocean
    expect(rift[0]).toBeGreaterThan(200);
    expect(rift[0]).toBeGreaterThan(rift[2] * 3);
    expect(lum(ocean)).toBeLessThan(60);
    expect(lum(rift)).toBeGreaterThan(lum(ocean) * 2);
  });

  it('frosts over at the poles', () => {
    const pole = at(130, -85);
    expect(lum(pole)).toBeGreaterThan(150);
  });
});

describe("Nexus Station's void", () => {
  const at = (lng: number, lat: number) => nexusVoid((lng + 180) / 360, (90 - lat) / 180, 9021);
  const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

  it('burns violet in the Gate crater and stays dark between the shards', () => {
    const gate = at(8, 0); // the Gate itself
    expect(gate[2]).toBeGreaterThan(gate[1]);
    expect(lum(gate)).toBeGreaterThan(120);
    let dark = 0;
    for (let lng = -40; lng <= 60; lng += 5) dark += lum(at(lng, 45));
    expect(dark / 21).toBeLessThan(60);
  });

  it('glows brighter on the breached far side than inside the shell', () => {
    let near = 0;
    let far = 0;
    for (let lat = -40; lat <= 40; lat += 5) {
      near += lum(at(8 + 60, lat));
      far += lum(at(-172, lat));
    }
    expect(far).toBeGreaterThan(near * 1.5);
  });

  it('stays in gamut everywhere', () => {
    for (let lng = -180; lng < 180; lng += 15) {
      for (let lat = -85; lat <= 85; lat += 10) {
        for (const ch of at(lng, lat)) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('galaxy neutral land and the Space to Stars Earth', () => {
  it("gives every designed world's unclaimed tiles its own land colour", () => {
    for (const id of ['sol', 'earth', 'moon', 'verdan', 'rust', 'nexus_station']) {
      expect(neutralLandColorFor(id, true), id).toMatch(/^rgb\(/);
      expect(neutralLandColorFor(id, false), id).toMatch(/^rgba\(.*0\.92\)$/);
    }
    expect(neutralLandColorFor('verdan', true)).not.toBe(neutralLandColorFor('rust', true));
  });

  it('leaves unknown worlds on the default neutral', () => {
    expect(neutralLandColorFor('xeno', true)).toBeUndefined();
    expect(neutralLandColorFor(null, true)).toBeUndefined();
  });

  it("paints Space to Stars' Earth as the ocean world Sol III is, not grey rock", () => {
    expect(planetKindFor('earth')).toBe('ocean');
    expect(planetProfileFor('earth').seed).toBe(planetProfileFor('sol').seed);
  });
});

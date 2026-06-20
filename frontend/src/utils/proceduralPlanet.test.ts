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
    const verdant = sample('verdant');
    // Desert should be warmer (more red than blue); ocean/verdant cooler/greener.
    expect(desert[0]).toBeGreaterThan(desert[2]);
    expect(ocean[2]).toBeGreaterThanOrEqual(ocean[0]);
    expect(verdant[1]).toBeGreaterThan(verdant[0]);
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

  it('makes land clearly brighter than ocean/void on every world', () => {
    const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    for (const kind of kinds) {
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

/**
 * Procedural planet textures for the Galactic Age (Goal: each world reads as a
 * genuinely distinct planet). Every galaxy world's globe surface is generated
 * from code — multi-octave value noise (longitude-wrapped so it tiles seamlessly
 * around the sphere) + a per-world colorizer + atmosphere already supplied by the
 * map skin. NOTHING is fetched and NOTHING is AI-generated: this is the no-AI,
 * no-CDN, zero-provenance-debt path. It replaces the previous per-world / per-
 * territory `globe_image_url` hot-links to ofrohn/threex.planets and three-globe.
 *
 * The result is a `data:image/png` URL (CSP already allows `data:` img-src), fed
 * straight to react-globe.gl's `globeImageUrl` prop and memoized per world so the
 * ~one-time generation cost is paid once per world per session.
 *
 * Pure helpers (noise/colorize/profiles) are exported for unit testing; the
 * canvas step is browser-only and degrades to `undefined` when no canvas exists
 * (callers then fall back to the globe's default), so this is safe under jsdom.
 */

export type PlanetKind = 'ocean' | 'verdant' | 'desert' | 'city' | 'rocky';

export interface PlanetProfile {
  /** Stable seed so a world always regenerates identically. */
  seed: number;
  kind: PlanetKind;
  /** Solid colour fallback (also used as a quick swatch). */
  fallback: string;
}

/** world_id → procedural identity. Unknown worlds get a neutral rocky look. */
const WORLD_PROFILES: Record<string, PlanetProfile> = {
  sol: { seed: 1207, kind: 'ocean', fallback: '#1d3f6b' },
  verdan: { seed: 4404, kind: 'verdant', fallback: '#1f6a4a' },
  rust: { seed: 7711, kind: 'desert', fallback: '#8a3f1e' },
  nexus_station: { seed: 9021, kind: 'city', fallback: '#10162e' },
};

const DEFAULT_PROFILE: PlanetProfile = { seed: 2025, kind: 'rocky', fallback: '#3a4358' };

export function planetProfileFor(worldId: string | null | undefined): PlanetProfile {
  if (!worldId) return DEFAULT_PROFILE;
  return WORLD_PROFILES[worldId] ?? DEFAULT_PROFILE;
}

export function planetKindFor(worldId: string | null | undefined): PlanetKind {
  return planetProfileFor(worldId).kind;
}

export function proceduralWorldFallbackColor(worldId: string | null | undefined): string {
  return planetProfileFor(worldId).fallback;
}

// ── Noise ────────────────────────────────────────────────────────────────────
// Integer-lattice value noise. The longitude axis (u) wraps at the lattice
// period (`freq` cells span u∈[0,1)), so `vnoise(0, …) === vnoise(1, …)` and the
// equirectangular texture has no visible seam at the antimeridian.

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function vnoise(u: number, v: number, freq: number, seed: number): number {
  const f = Math.max(2, Math.round(freq));
  const fx = u * f;
  const fy = v * f;
  const x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const xa = ((x0 % f) + f) % f;
  const xb = (((x0 + 1) % f) + f) % f;
  let y1 = y0 + 1;
  if (y0 < 0) y0 = 0;
  if (y1 > f) y1 = f;
  const a = hash(xa, y0, seed);
  const b = hash(xb, y0, seed);
  const c = hash(xa, y1, seed);
  const d = hash(xb, y1, seed);
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

export function fbm(u: number, v: number, base: number, oct: number, seed: number): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = base;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u, v, f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ── Colour ───────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

function hexToRgb(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function ramp(stops: RGB[], t: number): RGB {
  const tc = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const x = tc * n;
  const i = Math.min(n - 1, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

const PAL = {
  sol: ['#0c2549', '#15406f', '#2f6fae', '#5fa0c8'].map(hexToRgb),
  sol_land: ['#2c5c39', '#3f7a47', '#8a8b54', '#b9b58a'].map(hexToRgb),
  verdan: ['#0d3f3a', '#176a5d', '#2f8f4a'].map(hexToRgb),
  verdan_land: ['#1d4d28', '#2f7d3a', '#5fa544', '#9ed06a'].map(hexToRgb),
  rust: ['#451d0d', '#6e2f15', '#9a4a22', '#bf7a3e', '#d9a86a'].map(hexToRgb),
};
const FROST = hexToRgb('#d8c4b0');
const ICE = hexToRgb('#eef2f5');
const VERDAN_ICE = hexToRgb('#dfeede');
const SOL_PEAK = hexToRgb('#cfc6a6');
const JUNGLE = hexToRgb('#103a1c');
const NEXUS_LOW = hexToRgb('#080b1c');
const NEXUS_HIGH = hexToRgb('#14193a');
const NEXUS_DIM = hexToRgb('#3a2a66');
const CITY_WARM = hexToRgb('#ffcf7a');
const CITY_COOL = hexToRgb('#c9a3ff');
const ROCK = ['#23262f', '#3a4150', '#5a6273', '#8a93a4'].map(hexToRgb);

/** Albedo for one equirectangular texel. u∈[0,1) lon, v∈[0,1] lat (0 = north). */
export function colorize(kind: PlanetKind, u: number, v: number, seed: number): RGB {
  const lat = Math.abs(v - 0.5) * 2;

  if (kind === 'desert') {
    const e0 = fbm(u, v, 5, 6, seed);
    const streak = fbm(u, v, 22, 3, seed + 9);
    const e = e0 * 0.86 + streak * 0.14;
    let c = ramp(PAL.rust, (e - 0.25) / 0.6);
    if (lat > 0.8) c = mix(c, FROST, ((lat - 0.8) / 0.2) * 0.7);
    const b = 0.92 + 0.16 * fbm(u, v, 40, 2, seed + 3);
    return [c[0] * b, c[1] * b, c[2] * b];
  }

  if (kind === 'ocean') {
    const e = fbm(u, v, 4, 6, seed);
    let c: RGB;
    if (e < 0.5) {
      c = ramp(PAL.sol, e / 0.5);
    } else {
      const l = (e - 0.5) / 0.5;
      const lc = fbm(u, v, 9, 4, seed + 5);
      c = ramp(PAL.sol_land, lc);
      if (l > 0.7) c = mix(c, SOL_PEAK, ((l - 0.7) / 0.3) * 0.6);
    }
    if (lat > 0.82) c = mix(c, ICE, Math.min(1, (lat - 0.82) / 0.18) * 0.85);
    return c;
  }

  if (kind === 'verdant') {
    const e = fbm(u, v, 5, 6, seed);
    let c: RGB;
    if (e < 0.4) {
      c = ramp(PAL.verdan, e / 0.4);
    } else {
      const lc = fbm(u, v, 10, 5, seed + 7);
      c = ramp(PAL.verdan_land, lc);
      const jungle = fbm(u, v, 16, 3, seed + 2);
      if (jungle < 0.38) c = mix(c, JUNGLE, 0.5);
    }
    if (lat > 0.9) c = mix(c, VERDAN_ICE, ((lat - 0.9) / 0.1) * 0.6);
    return c;
  }

  if (kind === 'city') {
    const base = mix(NEXUS_LOW, NEXUS_HIGH, fbm(u, v, 3, 3, seed));
    const cont = fbm(u, v, 4, 3, seed + 11);
    const grid = fbm(u, v, 30, 2, seed + 5);
    const spark = fbm(u, v, 60, 2, seed + 8);
    if (cont > 0.52) {
      const dens = (cont - 0.52) / 0.48;
      if (grid > 0.62) {
        const warm = mix(CITY_WARM, CITY_COOL, spark);
        const g = Math.min(1, dens * 1.4 * ((grid - 0.62) / 0.38));
        return mix(base, warm, g * 0.95);
      }
      if (grid > 0.5) return mix(base, NEXUS_DIM, dens * 0.5);
    }
    return base;
  }

  // rocky (default for unknown worlds)
  const e = fbm(u, v, 5, 6, seed);
  let c = ramp(ROCK, e);
  if (lat > 0.85) c = mix(c, ICE, ((lat - 0.85) / 0.15) * 0.6);
  return c;
}

/** Fill an RGBA buffer with the equirectangular albedo for `profile`. */
export function fillEquirectRGBA(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  profile: PlanetProfile,
): void {
  let k = 0;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const c = colorize(profile.kind, u, v, profile.seed);
      data[k++] = c[0];
      data[k++] = c[1];
      data[k++] = c[2];
      data[k++] = 255;
    }
  }
}

// ── Texture (browser) ──────────────────────────────────────────────────────────
const textureCache = new Map<string, string>();

/**
 * Memoized `data:image/png` URL for a world's procedural surface. Width defaults
 * to 1024 (height = width/2; power-of-two for clean equirectangular wrapping).
 * Returns `undefined` when no 2D canvas is available (e.g. jsdom) so callers fall
 * back to the globe's built-in default.
 */
export function proceduralWorldTextureUrl(
  worldId: string | null | undefined,
  width = 1024,
): string | undefined {
  const profile = planetProfileFor(worldId);
  const key = `${worldId ?? 'default'}@${width}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return undefined;
  try {
    const height = width / 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const img = ctx.createImageData(width, height);
    fillEquirectRGBA(img.data, width, height, profile);
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    textureCache.set(key, url);
    return url;
  } catch {
    return undefined;
  }
}

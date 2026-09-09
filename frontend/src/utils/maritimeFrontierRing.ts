/**
 * Space Age ocean frontiers: turn an authored lat/lng rectangle into an
 * organic sea outline.
 *
 * The Space Age board's open-ocean and polar tiles ship a four-corner
 * `geo_polygon` — a literal rectangle in WGS84. Every land territory around
 * them renders from Natural Earth coastlines, so the sea tiles read as cut-out
 * squares dropped onto a real map, which is what they look like in play.
 *
 * The Galactic Age already solved the same problem for its exo-worlds
 * (`buildOrganicGalaxyCapRing`), and this is deliberately its sibling rather
 * than a second invention. It differs in one way that matters for water: the
 * galaxy builder offsets each of the four edges and keeps the corners, so its
 * output is still recognisably a rectangle with wavy sides. A sea feature has
 * no corners at all, so this samples radially around an inscribed ellipse
 * instead — the ring is a closed loop from the start and there is no corner to
 * survive smoothing.
 *
 * Rings stay inside the authored rectangle. The rectangle is where the designer
 * placed the tile and how far it may reach toward its neighbours; the shape
 * inside it is ours to choose, its footprint is not.
 *
 * Output is deterministic: the same territory id always yields the same
 * outline, so the board does not reshuffle between renders, sessions or
 * players.
 */

import { signedLngLatRingArea } from './galaxyOrganicGlobeRing';

export interface MaritimeRingProfile {
  /** Points sampled around the ring. Higher = finer detail before smoothing. */
  samples: number;
  /**
   * How deeply the wobble carves in from the base curve, as a fraction of the
   * local radius. Displacement is inward only: the ring then touches the
   * authored rectangle at its widest points and never crosses it, so nothing
   * has to be clamped back. Clamping a boxy outline that had been pushed
   * outward folded points onto the edge and left a visible notch at the end of
   * each Arctic band.
   */
  roughness: number;
  /**
   * Lobes around the ring. Low values give a few broad bulges (a gyre, a
   * shelf edge); high values give a scalloped, cluster-like edge.
   */
  lobes: number;
  /** Circular smoothing passes. More = softer, glassier water. */
  smoothPasses: number;
  /** Fraction of the half-extent the base curve fills before wobble is added. */
  inset: number;
  /**
   * Corner fullness of the base curve, as the superellipse exponent.
   * 1 is a plain ellipse; lower values push the curve out toward the corners
   * (0.5 is a squircle) while still rounding them.
   *
   * This exists because an ellipse is the wrong primitive for a wide, shallow
   * tile: inscribed in the 90-by-5-degree Arctic band it tapers to a sliver at
   * both ends and throws away most of the tile's area. A band needs to stay a
   * band — just one without corners.
   */
  fullness: number;
}

/**
 * Per-feature silhouettes. The Space Age sea tiles are not one thing — a
 * reclaimed gyre, a seastead cluster and a drilling-platform field should not
 * share an outline — so each gets its own character while all read as water.
 */
export const MARITIME_PROFILES = {
  /** Broad, smooth, slightly elongated — a current, not an object. */
  gyre: { samples: 72, roughness: 0.3, lobes: 3, smoothPasses: 3, inset: 1, fullness: 0.85 },
  /** Scalloped: many small settlements strung together. */
  cluster: { samples: 84, roughness: 0.34, lobes: 6, smoothPasses: 2, inset: 1, fullness: 0.75 },
  /** A scattered field of rigs — irregular, no dominant axis. */
  field: { samples: 76, roughness: 0.34, lobes: 5, smoothPasses: 2, inset: 1, fullness: 0.78 },
  /**
   * Ice-shelf margin. Nearly rectangular on purpose: these are wide, shallow
   * polar bands, so the shape work is softening the ends and giving the
   * seaward edge a slow swell, not turning the band into a blob.
   */
  shelf: { samples: 96, roughness: 0.3, lobes: 3, smoothPasses: 3, inset: 1, fullness: 0.34 },
  /** Compact and near-round: a single engineered structure at sea. */
  anchor: { samples: 64, roughness: 0.18, lobes: 4, smoothPasses: 3, inset: 0.94, fullness: 1 },
} as const satisfies Record<string, MaritimeRingProfile>;

export type MaritimeProfileName = keyof typeof MARITIME_PROFILES;

/**
 * Which Space Age frontier gets which silhouette. Keyed by territory id
 * because these are authored, named places — a Pacific seastead cluster and a
 * reclaimed gyre sit in the same region but should not look alike.
 */
export const MARITIME_FRONTIER_PROFILES: Record<string, MaritimeProfileName> = {
  pacific_seasteads: 'cluster',
  north_pacific_gyre: 'gyre',
  south_atlantic_platforms: 'field',
  equatorial_orbital_anchor: 'anchor',
  arctic_reclamation: 'shelf',
  arctic_siberian_shelf: 'shelf',
};

/**
 * Whether a territory is one of the Space Age sea frontiers.
 *
 * Shape and styling answer to the same list on purpose: a tile drawn with a
 * sea outline should also be painted as water, and the two cannot drift.
 */
export function isSeaFrontier(territoryId: string): boolean {
  return Object.prototype.hasOwnProperty.call(MARITIME_FRONTIER_PROFILES, territoryId);
}

/** FNV-1a over the seed string → [0, 1). Matches galaxyOrganicGlobeRing. */
function stableNoise01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 4096) / 4096;
}

function smoothRingCircularInPlace(ring: [number, number][], passes: number): void {
  if (ring.length < 4 || passes <= 0) return;
  const n = ring.length;
  for (let p = 0; p < passes; p++) {
    const next: [number, number][] = ring.map((_, i) => {
      const prev = ring[(i + n - 1) % n];
      const curr = ring[i];
      const nxt = ring[(i + 1) % n];
      return [
        (prev[0] + curr[0] * 2 + nxt[0]) / 4,
        (prev[1] + curr[1] * 2 + nxt[1]) / 4,
      ];
    });
    for (let i = 0; i < n; i++) ring[i] = next[i];
  }
}

/**
 * Build an organic sea outline inscribed in the bounding box of `corners`.
 *
 * `corners` is the authored ring, open or closed. Anything that is not a
 * four-corner rectangle is returned untouched: a hand-drawn sea shape is
 * already the thing this function exists to produce.
 */
export function buildMaritimeFrontierRing(
  corners: [number, number][],
  territoryId: string,
  profileName: MaritimeProfileName,
): [number, number][] {
  const open =
    corners.length > 1 &&
    corners[0][0] === corners[corners.length - 1][0] &&
    corners[0][1] === corners[corners.length - 1][1]
      ? corners.slice(0, -1)
      : corners;
  if (open.length !== 4) return corners;

  const profile = MARITIME_PROFILES[profileName];
  const minLng = Math.min(...open.map((c) => c[0]));
  const maxLng = Math.max(...open.map((c) => c[0]));
  const minLat = Math.min(...open.map((c) => c[1]));
  const maxLat = Math.max(...open.map((c) => c[1]));
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  const rx = ((maxLng - minLng) / 2) * profile.inset;
  const ry = ((maxLat - minLat) / 2) * profile.inset;
  if (rx <= 0 || ry <= 0) return corners;

  // Two fixed phase offsets per territory, so two tiles sharing a profile still
  // differ. Drawn from the id alone, which is what keeps the shape stable.
  const phaseA = stableNoise01(`${territoryId}|maritime|a`) * Math.PI * 2;
  const phaseB = stableNoise01(`${territoryId}|maritime|b`) * Math.PI * 2;

  const ring: [number, number][] = [];
  for (let i = 0; i < profile.samples; i++) {
    const theta = (i / profile.samples) * Math.PI * 2;
    // Two harmonics rather than per-point random noise: sampled continuously
    // around the loop, they close on themselves seamlessly, so there is no
    // discontinuity where the ring meets its own start.
    const wobble =
      Math.sin(theta * profile.lobes + phaseA) * 0.62 +
      Math.sin(theta * (profile.lobes * 2 + 1) + phaseB) * 0.38;
    // Inward only, so the ring is inscribed by construction: r runs from
    // 1 - roughness up to 1, never past the authored rectangle.
    const r = 1 - profile.roughness * (0.5 + 0.5 * wobble);
    // Superellipse: |cos|^p and |sin|^p keep the sign of the plain circle but
    // push the curve toward the corners as p falls below 1.
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const ex = Math.sign(c) * Math.abs(c) ** profile.fullness;
    const ey = Math.sign(sn) * Math.abs(sn) ** profile.fullness;
    ring.push([cx + rx * r * ex, cy + ry * r * ey]);
  }

  smoothRingCircularInPlace(ring, profile.smoothPasses);

  // Keep the tile inside its authored footprint: smoothing can pull a point
  // past the edge, and a sea tile that creeps outward would overlap the
  // neighbour whose rectangle starts there.
  for (const pt of ring) {
    pt[0] = Math.min(maxLng, Math.max(minLng, pt[0]));
    pt[1] = Math.min(maxLat, Math.max(minLat, pt[1]));
  }

  // Same winding convention as the galaxy caps, so both organic paths hand the
  // renderer rings in one orientation.
  if (signedLngLatRingArea(ring) <= 0) ring.reverse();

  return [...ring, [...ring[0]] as [number, number]];
}

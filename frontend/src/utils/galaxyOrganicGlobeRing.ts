/**
 * Galactic Age globe caps: turn authored canvas rectangles into irregular,
 * lore-appropriate frontiers for `three-conic-polygon-geometry` / d3-geo.
 *
 * The rectangle vertices from `canvasToGeoJSONRegional` are walked math-clockwise
 * (NW→NE→SE→SW). Interior lies to the right of each directed edge; offsets use
 * the inward normal so borders bulge without flipping winding.
 */

export interface GalaxyOrganicRingProfile {
  /** Points sampled per rectangle edge before smoothing (excluding shared corners). */
  segmentsPerEdge: number;
  /** Max perpendicular jitter in degrees (before smoothing). */
  amplitudeDeg: number;
  /** Circular smoothing passes over the ring. */
  smoothPasses: number;
}

const WORLD_ORGANIC_PROFILE: Record<string, GalaxyOrganicRingProfile> = {
  // Earth analogue — coast-like meanders, older treaties
  sol: { segmentsPerEdge: 12, amplitudeDeg: 0.52, smoothPasses: 2 },
  // Sulphur jungle — softer, biological curves
  verdan: { segmentsPerEdge: 14, amplitudeDeg: 0.62, smoothPasses: 3 },
  // Forge-world — harder angles, mining fronts
  rust: { segmentsPerEdge: 11, amplitudeDeg: 0.4, smoothPasses: 2 },
  // Pathfinder shell — crater rims, cracked plates
  nexus_station: { segmentsPerEdge: 13, amplitudeDeg: 0.48, smoothPasses: 2 },
};

const DEFAULT_PROFILE: GalaxyOrganicRingProfile = WORLD_ORGANIC_PROFILE.sol;

function stableNoise01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 4096) / 4096;
}

/** Signed planar area / 2 for ring [lng, lat]; >0 ⇒ math-CW when lat is y-up. */
export function signedLngLatRingArea(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    sum += (x2 - x1) * (y2 + y1);
  }
  return sum / 2;
}

function smoothRingCircularInPlace(ring: [number, number][], passes: number): void {
  if (ring.length < 4 || passes <= 0) return;
  const n = ring.length;
  for (let p = 0; p < passes; p++) {
    const next: [number, number][] = ring.map((_, i) => {
      const prev = ring[(i + n - 1) % n];
      const curr = ring[i];
      const nxt = ring[(i + 1) % n];
      return [(prev[0] + 2 * curr[0] + nxt[0]) / 4, (prev[1] + 2 * curr[1] + nxt[1]) / 4];
    });
    for (let i = 0; i < n; i++) {
      ring[i][0] = next[i][0];
      ring[i][1] = next[i][1];
    }
  }
}

function clampRingToBounds(
  ring: [number, number][],
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number,
  marginDeg: number,
): void {
  for (const pt of ring) {
    pt[0] = Math.min(maxLng + marginDeg, Math.max(minLng - marginDeg, pt[0]));
    pt[1] = Math.min(maxLat + marginDeg, Math.max(minLat - marginDeg, pt[1]));
  }
}

/**
 * `corners` — four rectangle vertices in canvas projection order (NW→NE→SE→SW),
 * **open** ring (first point not repeated at end).
 */
export function buildOrganicGalaxyCapRing(
  corners: [number, number][],
  territoryId: string,
  worldId: string,
): [number, number][] {
  if (corners.length !== 4) return corners;

  const profile = WORLD_ORGANIC_PROFILE[worldId] ?? DEFAULT_PROFILE;
  const { segmentsPerEdge, amplitudeDeg, smoothPasses } = profile;

  const minLng = Math.min(...corners.map((c) => c[0]));
  const maxLng = Math.max(...corners.map((c) => c[0]));
  const minLat = Math.min(...corners.map((c) => c[1]));
  const maxLat = Math.max(...corners.map((c) => c[1]));

  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 4];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len = Math.hypot(dx, dy) || 1;
    // Inward normal for math-CW traversal: right-hand perpendicular of edge direction.
    const nx = dy / len;
    const ny = -dx / len;

    for (let j = 0; j < segmentsPerEdge; j++) {
      const t = j / segmentsPerEdge;
      let px = A[0] + dx * t;
      let py = A[1] + dy * t;

      const seed = `${territoryId}|${worldId}|e${i}|s${j}`;
      const n1 = stableNoise01(seed);
      const n2 = stableNoise01(`${seed}|o`);
      // Primary irregularity + slower envelope so borders feel “negotiated”, not uniform noise.
      const wobble =
        amplitudeDeg *
        ((n1 * 2 - 1) * 0.72 + (n2 * 2 - 1) * 0.28 * Math.sin(Math.PI * t));

      px += nx * wobble;
      py += ny * wobble;
      pts.push([px, py]);
    }
  }

  clampRingToBounds(pts, minLng, maxLng, minLat, maxLat, 0.85);
  smoothRingCircularInPlace(pts, smoothPasses);
  clampRingToBounds(pts, minLng, maxLng, minLat, maxLat, 0.95);

  // Preserve spherical CW winding for d3-geo / conic triangulation.
  if (signedLngLatRingArea(pts) <= 0) {
    pts.reverse();
  }

  return pts;
}

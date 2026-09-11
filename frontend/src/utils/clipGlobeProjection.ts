/**
 * Orthographic globe projection for the replay clip exporter.
 *
 * The exported clip used to draw each territory's authored `polygon` — the
 * blocky seed rectangles from map authoring — because that is all the flat
 * board needed. Nobody plays on those: both the 2D map and the 3D globe render
 * real Natural Earth geometry (see map2dProjection / GlobeMap), so a shared
 * clip looked nothing like the match it came from.
 *
 * This projects that same lon/lat geometry onto a sphere the way the globe
 * shows it, in plain 2D canvas. WebGL is deliberately avoided: the GIF encoder
 * reads frames back with `getImageData`, and capturing a live three.js surface
 * would mean `preserveDrawingBuffer` and a camera we do not own.
 *
 * Orthographic (a camera at infinite distance) rather than perspective: it is
 * exact, cheap, has no near-plane surprises, and at the framings a match uses
 * the difference from react-globe.gl's perspective camera is not visible.
 */

const DEG = Math.PI / 180;

/** Camera: the lon/lat facing the viewer, and how much of the globe to cover. */
export interface ClipGlobeCamera {
  centerLng: number;
  centerLat: number;
  /**
   * Angular distance from the center, in degrees, that must fit inside the
   * frame. 90 shows the whole visible hemisphere; smaller values zoom in.
   */
  angularRadiusDeg: number;
}

export interface ClipGlobeViewport {
  /** Disc center in canvas pixels. */
  cx: number;
  cy: number;
  /** Sphere radius in canvas pixels. Points at the limb sit exactly this far out. */
  radius: number;
}

/** Camera-frame coordinates on the unit sphere: x right, y up, z toward the viewer. */
export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * lon/lat → unit-sphere coordinates in the camera's frame.
 *
 * `z > 0` is the near hemisphere (visible); `z <= 0` is around the back. The
 * screen position of a visible point is simply (x, -y) scaled by the radius —
 * that is what makes orthographic worth using here.
 */
export function toCameraFrame(lng: number, lat: number, cam: ClipGlobeCamera): SpherePoint {
  const phi = lat * DEG;
  const lambda = (lng - cam.centerLng) * DEG;
  const phi0 = cam.centerLat * DEG;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosL = Math.cos(lambda);
  const sinL = Math.sin(lambda);
  const cos0 = Math.cos(phi0);
  const sin0 = Math.sin(phi0);
  return {
    x: cosPhi * sinL,
    y: sinPhi * cos0 - cosPhi * sin0 * cosL,
    z: sinPhi * sin0 + cosPhi * cos0 * cosL,
  };
}

/** Pixel scale of the sphere for a camera that must cover `angularRadiusDeg`. */
export function globeRadiusPx(cam: ClipGlobeCamera, fitRadiusPx: number): number {
  // A point θ from the center lands at sin(θ) on the unit disc, so covering θmax
  // inside `fitRadiusPx` needs a sphere of fitRadiusPx / sin(θmax).
  const theta = Math.min(90, Math.max(1, cam.angularRadiusDeg)) * DEG;
  return fitRadiusPx / Math.max(0.02, Math.sin(theta));
}

/**
 * Project a lon/lat ring to canvas points, or null when it is entirely behind
 * the globe.
 *
 * A ring that straddles the horizon has its hidden vertices pushed out onto the
 * limb rather than dropped, and consecutive pushed vertices are joined along the
 * limb arc. Dropping them instead would cut a straight chord across the disc and
 * take a visible bite out of any territory sitting on the edge of the world.
 * Territories are far smaller than a hemisphere, so a pushed run never wraps far
 * enough around the back for that arc to be ambiguous.
 */
export function projectRing(
  ring: ReadonlyArray<readonly [number, number]>,
  cam: ClipGlobeCamera,
  view: ClipGlobeViewport,
): [number, number][] | null {
  if (ring.length < 3) return null;

  const pts: SpherePoint[] = new Array(ring.length);
  let anyVisible = false;
  for (let i = 0; i < ring.length; i++) {
    const p = toCameraFrame(ring[i][0], ring[i][1], cam);
    pts[i] = p;
    if (p.z > 0) anyVisible = true;
  }
  if (!anyVisible) return null;

  const out: [number, number][] = [];
  // Canvas y grows downward while the sphere's y grows north, hence the flip.
  const toCanvas = (x: number, y: number): [number, number] => [
    view.cx + x * view.radius,
    view.cy - y * view.radius,
  ];
  /** Angle of a hidden point's limb position, or null when it is degenerate. */
  const limbAngle = (p: SpherePoint): number | null => {
    const r = Math.hypot(p.x, p.y);
    // Within a whisker of the antipode there is no meaningful direction to push
    // toward; skipping the vertex is better than inventing one.
    return r < 1e-9 ? null : Math.atan2(p.y, p.x);
  };

  let prevLimb: number | null = null;
  for (const p of pts) {
    if (p.z > 0) {
      out.push(toCanvas(p.x, p.y));
      prevLimb = null;
      continue;
    }
    const angle = limbAngle(p);
    if (angle == null) continue;
    if (prevLimb != null) {
      // Walk the shorter way round so the fill hugs the rim instead of
      // chording across it.
      let delta = angle - prevLimb;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const steps = Math.min(48, Math.max(1, Math.ceil(Math.abs(delta) / (4 * DEG))));
      for (let s = 1; s < steps; s++) {
        const a = prevLimb + (delta * s) / steps;
        out.push(toCanvas(Math.cos(a), Math.sin(a)));
      }
    }
    out.push(toCanvas(Math.cos(angle), Math.sin(angle)));
    prevLimb = angle;
  }

  return out.length >= 3 ? out : null;
}

export interface AngularExtent {
  centerLng: number;
  centerLat: number;
  /** Greatest angular distance (degrees) from the center to any input point. */
  radiusDeg: number;
}

function unitVector(lng: number, lat: number): [number, number, number] {
  const phi = lat * DEG;
  const lambda = lng * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

/**
 * A cap covering every point: the mean direction on the sphere, then the
 * furthest angular distance from it. Pass `center` to keep a camera position
 * the map authored and only measure how much of the sphere it has to cover.
 *
 * Averaging 3D directions rather than raw degrees is what keeps a map spanning
 * the date line (Pacific theaters, any world map) from centering on longitude 0
 * — the exact averaging bug that would put the camera on the wrong side of the
 * planet from the match.
 */
export function angularExtentOf(
  points: ReadonlyArray<readonly [number, number]>,
  center?: { lng: number; lat: number },
): AngularExtent | null {
  if (points.length === 0) return null;

  let cx: number;
  let cy: number;
  let cz: number;
  let centerLng: number;
  let centerLat: number;

  if (center) {
    [cx, cy, cz] = unitVector(center.lng, center.lat);
    centerLng = center.lng;
    centerLat = center.lat;
  } else {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const [lng, lat] of points) {
      const [vx, vy, vz] = unitVector(lng, lat);
      sx += vx;
      sy += vy;
      sz += vz;
    }
    const norm = Math.hypot(sx, sy, sz);
    // Points spread evenly over the whole globe cancel out; face the prime
    // meridian and cover everything rather than dividing by ~0.
    if (norm < 1e-6) return { centerLng: 0, centerLat: 0, radiusDeg: 90 };
    cx = sx / norm;
    cy = sy / norm;
    cz = sz / norm;
    centerLat = Math.asin(Math.max(-1, Math.min(1, cz))) / DEG;
    centerLng = Math.atan2(cy, cx) / DEG;
  }

  let radiusDeg = 0;
  for (const [lng, lat] of points) {
    const [vx, vy, vz] = unitVector(lng, lat);
    const dot = vx * cx + vy * cy + vz * cz;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
    if (ang > radiusDeg) radiusDeg = ang;
  }
  return { centerLng, centerLat, radiusDeg };
}

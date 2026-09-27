/**
 * Small spherical-geometry helpers shared by the world specs (which place
 * things relative to a world's own landmarks) and the skeleton builder.
 */
import type { LngLat } from './worldSpecs';

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

export function toVec(lng: number, lat: number): Vec3 {
  const l = lng * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

export function toLngLat(v: Vec3): LngLat {
  const n = Math.hypot(v[0], v[1], v[2]);
  const lng = Math.atan2(v[1], v[0]) / RAD;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / RAD;
  return [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Great-circle distance in degrees. */
export function angleDeg(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / RAD;
}

/**
 * The point `dist` degrees from `center` along `azimuth` (0 = toward the north
 * pole, 90 = east). Lets a spec describe a world in its own frame — "72° from
 * the substellar point, bearing 34°" — so the whole design moves rigidly when
 * its centre does.
 */
export function polar(center: LngLat, azimuth: number, dist: number): LngLat {
  const c = toVec(center[0], center[1]);
  let east = cross([0, 0, 1], c);
  if (Math.hypot(east[0], east[1], east[2]) < 1e-9) east = [0, 1, 0];
  east = normalize(east);
  const north = cross(c, east);
  const a = azimuth * RAD;
  const d = dist * RAD;
  const t: Vec3 = [
    Math.cos(a) * north[0] + Math.sin(a) * east[0],
    Math.cos(a) * north[1] + Math.sin(a) * east[1],
    Math.cos(a) * north[2] + Math.sin(a) * east[2],
  ];
  return toLngLat([
    Math.cos(d) * c[0] + Math.sin(d) * t[0],
    Math.cos(d) * c[1] + Math.sin(d) * t[1],
    Math.cos(d) * c[2] + Math.sin(d) * t[2],
  ]);
}

/** Points every ~`stepDeg` along the great-circle polyline through `points`. */
export function sampleGreatCircle(points: LngLat[], stepDeg: number): Vec3[] {
  return samplePolyline(points, stepDeg).map((s) => s.v);
}

/**
 * The same samples, each with the segment it lies on and how far along it
 * (0..1), so a caller can interpolate a per-vertex value such as a radius.
 */
export function samplePolyline(points: LngLat[], stepDeg: number): Array<{ v: Vec3; seg: number; t: number }> {
  const vs = points.map(([lng, lat]) => toVec(lng, lat));
  const out: Array<{ v: Vec3; seg: number; t: number }> = [];
  for (let i = 0; i < vs.length - 1; i++) {
    const a = vs[i];
    const b = vs[i + 1];
    const om = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    const n = Math.max(2, Math.floor(om / RAD / stepDeg));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      if (om < 1e-9) { out.push({ v: a, seg: i, t }); continue; }
      const s0 = Math.sin((1 - t) * om) / Math.sin(om);
      const s1 = Math.sin(t * om) / Math.sin(om);
      out.push({ v: [s0 * a[0] + s1 * b[0], s0 * a[1] + s1 * b[1], s0 * a[2] + s1 * b[2]], seg: i, t });
    }
  }
  out.push({ v: vs[vs.length - 1], seg: vs.length - 2, t: 1 });
  return out;
}

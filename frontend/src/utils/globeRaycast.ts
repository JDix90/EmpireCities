/**
 * The globe's hover check skips what nobody can point at.
 *
 * three-render-objects hit-tests the pointer against the whole globe every
 * 50 ms while the globe draws. It is the hover check behind the name tooltip,
 * and it also resolves taps: a click goes to whatever the last check found.
 * three.js tests hidden objects as readily as visible ones, and globe.gl
 * drops what it cannot use only after the test, so every check also tested:
 *
 * - the tile engine's sphere, 32,040 triangles, hidden whenever no tile
 *   server is set, which is always here;
 * - the graticules, hidden unless they are switched on;
 * - the atmosphere shell, whose hits globe.gl's hover filter always drops;
 * - the globe itself, triangle by triangle.
 *
 * Together that was about two thirds of each check. This module takes over
 * the hit-test of the globe's root object (the one object three-render-objects
 * asks three.js to test): it walks the same tree, skips hidden objects and
 * the atmosphere, and meets the globe's sphere with the exact ray-sphere
 * solution instead of its triangles. Territories, arcs and everything else
 * are tested by three.js exactly as before, and anything above the globe's
 * surface is still met before the surface, so a check finds the same objects
 * in the same order. A hit on the globe now lands on the true sphere rather
 * than its drawn facets: the same spot on screen, within about a pixel's width
 * of surface of where it landed before. Only the outline it can be hit within
 * changes, a fraction of a pixel wider at the rim.
 */

interface Vec3 {
  x: number;
  y: number;
  z: number;
  clone(): Vec3;
  set(x: number, y: number, z: number): Vec3;
  applyMatrix4(m: Mat4): Vec3;
  distanceTo(v: Vec3): number;
}

interface Mat4 {
  clone(): Mat4;
  invert(): Mat4;
}

interface RayLike {
  origin: Vec3;
  direction: Vec3;
  clone(): RayLike;
  applyMatrix4(m: Mat4): RayLike;
}

interface RaycasterLike {
  ray: RayLike;
  near: number;
  far: number;
  layers: unknown;
}

interface Hit {
  distance: number;
  point: Vec3;
  object: SceneObject;
  face?: null;
}

interface SphereParameters {
  radius: number;
  phiStart: number;
  phiLength: number;
  thetaStart: number;
  thetaLength: number;
}

interface SceneObject {
  visible: boolean;
  children: SceneObject[];
  parent: SceneObject | null;
  layers: { test(layers: unknown): boolean };
  matrixWorld: Mat4;
  raycast(raycaster: RaycasterLike, intersects: Hit[]): boolean | void;
  isMesh?: boolean;
  geometry?: { type?: string; parameters?: Partial<SphereParameters> };
  material?: { side?: number } | unknown[];
  __globeObjType?: string;
}

/** three.js's `FrontSide`. */
const FRONT_SIDE = 0;
const PRUNED = Symbol.for('borderfall.globeRaycast');

/** The globe's own sphere: a whole sphere drawn on its front faces, directly in the globe group. */
function isGlobeSphere(object: SceneObject): boolean {
  if (object.isMesh !== true || object.parent?.__globeObjType !== 'globe') return false;
  if (object.geometry?.type !== 'SphereGeometry') return false;
  const p = object.geometry.parameters;
  const material = object.material;
  return (
    !!p &&
    typeof p.radius === 'number' &&
    p.phiStart === 0 &&
    Math.abs((p.phiLength ?? 0) - 2 * Math.PI) < 1e-9 &&
    p.thetaStart === 0 &&
    Math.abs((p.thetaLength ?? 0) - Math.PI) < 1e-9 &&
    !!material &&
    !Array.isArray(material) &&
    (material as { side?: number }).side === FRONT_SIDE
  );
}

/**
 * Where the ray enters the sphere, as three.js reports a front-face hit:
 * nothing from inside the sphere, nothing behind the ray, nothing past `far`.
 */
function intersectGlobeSphere(object: SceneObject, raycaster: RaycasterLike, intersects: Hit[]): void {
  const radius = object.geometry!.parameters!.radius!;
  const local = raycaster.ray.clone().applyMatrix4(object.matrixWorld.clone().invert());
  const o = local.origin;
  const d = local.direction;
  const b = o.x * d.x + o.y * d.y + o.z * d.z;
  const c = o.x * o.x + o.y * o.y + o.z * o.z - radius * radius;
  if (c <= 0) return;
  const disc = b * b - c;
  if (disc < 0) return;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return;
  const point = o.clone().set(o.x + t * d.x, o.y + t * d.y, o.z + t * d.z).applyMatrix4(object.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(point);
  if (distance < raycaster.near || distance > raycaster.far) return;
  // globe.gl reads only the point of a globe hit (toGlobeCoords, onGlobeClick).
  intersects.push({ distance, point, object, face: null });
}

/** three.js's own traversal, less the objects no one can point at. */
function intersectVisible(object: SceneObject, raycaster: RaycasterLike, intersects: Hit[]): void {
  if (!object.visible || object.__globeObjType === 'atmosphere') return;
  let propagate = true;
  if (object.layers.test(raycaster.layers)) {
    if (isGlobeSphere(object)) intersectGlobeSphere(object, raycaster, intersects);
    else if (object.raycast(raycaster, intersects) === false) propagate = false;
  }
  if (propagate) for (const child of object.children) intersectVisible(child, raycaster, intersects);
}

/** A globe.gl globe's root: the three-globe object it hands three-render-objects to hit-test. */
function isGlobeRoot(object: unknown): object is SceneObject {
  const o = object as { toGeoCoords?: unknown; getCoords?: unknown; children?: unknown } | null;
  return !!o && typeof o.toGeoCoords === 'function' && typeof o.getCoords === 'function' && Array.isArray(o.children);
}

/**
 * Take over the hit-test of each globe in `scene`. Safe to call again, on
 * every globe-ready. Returns how many globes it covers.
 */
export function pruneGlobeHoverRaycasts(scene: unknown): number {
  const children = (scene as { children?: unknown[] } | null)?.children;
  if (!Array.isArray(children)) return 0;
  let covered = 0;
  for (const child of children) {
    if (!isGlobeRoot(child)) continue;
    const root = child as SceneObject & { [PRUNED]?: true };
    if (!root[PRUNED]) {
      root.raycast = function raycastVisible(this: SceneObject, raycaster, intersects) {
        for (const c of this.children) intersectVisible(c, raycaster, intersects);
        // Its children are done: three.js must not walk them again.
        return false;
      };
      root[PRUNED] = true;
    }
    covered += 1;
  }
  return covered;
}

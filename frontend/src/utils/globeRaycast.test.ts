import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- three.js ships no type definitions, and this repo has none installed
import * as THREE from 'three';
import { pruneGlobeHoverRaycasts } from './globeRaycast';

/**
 * A globe laid out as three-globe builds one: a root object with the globe
 * group (the drawn sphere and a hidden tile engine with its own sphere),
 * hidden graticules, the atmosphere and a territory standing on the surface.
 */
function buildGlobe() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.toGeoCoords = () => ({ lat: 0, lng: 0 });
  root.getCoords = () => ({ x: 0, y: 0, z: 0 });
  scene.add(root);

  const globeGroup = new THREE.Group();
  globeGroup.__globeObjType = 'globe';
  const globe = new THREE.Mesh(new THREE.SphereGeometry(100, 90, 45), new THREE.MeshBasicMaterial());
  globe.rotation.y = -Math.PI / 2;
  const tileEngine = new THREE.Group();
  tileEngine.visible = false;
  const tileSphere = new THREE.Mesh(new THREE.SphereGeometry(99, 180, 90), new THREE.MeshBasicMaterial());
  tileEngine.add(tileSphere);
  globeGroup.add(globe, tileEngine);

  const graticules = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-150, 0, 120), new THREE.Vector3(150, 0, 120)]),
    new THREE.LineBasicMaterial(),
  );
  graticules.visible = false;

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(115, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  atmosphere.__globeObjType = 'atmosphere';

  const territory = new THREE.Group();
  territory.__globeObjType = 'polygon';
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  cap.position.set(30, 20, 101);
  territory.add(cap);

  root.add(globeGroup, graticules, atmosphere, territory);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  camera.position.set(0, 0, 300);
  camera.lookAt(0, 0, 0);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return { scene, root, globe, tileSphere, graticules, atmosphere, cap, camera };
}

type Point = { clone(): Point; normalize(): Point; multiplyScalar(s: number): Point; dot(p: Point): number; distanceTo(p: Point): number; length(): number };
type HitList = Array<{ object: unknown; point: Point; distance: number }> & { direction?: Point };

/** What three-render-objects does for each hover check. */
function hits(g: ReturnType<typeof buildGlobe>, x: number, y: number): HitList {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x, y), g.camera);
  const list = raycaster.intersectObjects([g.root], true) as HitList;
  list.direction = raycaster.ray.direction;
  return list;
}

/**
 * How far apart two hits on the sphere lie on its surface, in screen pixels of
 * a view 1,000 pixels tall: the surface one pixel covers grows as the ray
 * grazes the globe.
 */
function surfaceShiftInPixels(a: Point, b: Point, distance: number, direction: Point) {
  const onSurface = (p: Point) => p.clone().normalize().multiplyScalar(100);
  const pixel = (2 * distance * Math.tan((50 * Math.PI) / 360)) / 1000;
  const facing = Math.max(Math.abs(b.clone().normalize().dot(direction)), 1e-6);
  return onSurface(a).distanceTo(onSurface(b)) / (pixel / facing);
}

/** globe.gl's reading of a check: the first hit it can use, and the first globe hit (toGlobeCoords). */
function reading(g: ReturnType<typeof buildGlobe>, list: HitList) {
  const usable = list.find((h) => h.object === g.globe || h.object === g.cap);
  const globeHit = list.find((h) => h.object === g.globe);
  return { usable: usable?.object ?? null, globePoint: globeHit?.point ?? null, globeDistance: globeHit?.distance ?? 0, direction: list.direction! };
}

const POINTS = [-0.9, -0.6, -0.3, 0, 0.15, 0.3, 0.45, 0.6, 0.9];

describe('pruneGlobeHoverRaycasts', () => {
  it('finds the same object and the same globe point as three.js on its own', () => {
    const plain = buildGlobe();
    const pruned = buildGlobe();
    expect(pruneGlobeHoverRaycasts(pruned.scene)).toBe(1);
    let globeHits = 0;
    for (const x of POINTS) {
      for (const y of POINTS) {
        const a = reading(plain, hits(plain, x, y));
        const b = reading(pruned, hits(pruned, x, y));
        expect(b.usable === null).toBe(a.usable === null);
        if (a.usable) expect(b.usable).toBe(a.usable === plain.globe ? pruned.globe : pruned.cap);
        expect(b.globePoint === null).toBe(a.globePoint === null);
        if (a.globePoint && b.globePoint) {
          globeHits += 1;
          // The same ray, met at the true sphere instead of the drawn facets
          // just inside it: the same spot on screen, under a pixel apart.
          expect(surfaceShiftInPixels(a.globePoint, b.globePoint, b.globeDistance, b.direction)).toBeLessThan(1);
        }
      }
    }
    expect(globeHits).toBeGreaterThan(20);
  });

  it('puts the hit on the sphere itself', () => {
    const g = buildGlobe();
    pruneGlobeHoverRaycasts(g.scene);
    const globeHit = hits(g, -0.4, -0.3).find((h) => h.object === g.globe)!;
    expect(globeHit.point.length()).toBeCloseTo(100, 6);
  });

  it('leaves hidden objects, the atmosphere and the globe\'s triangles untested', () => {
    const g = buildGlobe();
    pruneGlobeHoverRaycasts(g.scene);
    const spies = [g.tileSphere, g.graticules, g.atmosphere, g.globe, g.cap].map((o) => vi.spyOn(o, 'raycast'));
    hits(g, 0.15, 0.1);
    const [tile, graticules, atmosphere, globe, cap] = spies;
    expect(tile).not.toHaveBeenCalled();
    expect(graticules).not.toHaveBeenCalled();
    expect(atmosphere).not.toHaveBeenCalled();
    expect(globe).not.toHaveBeenCalled();
    expect(cap).toHaveBeenCalledTimes(1);
  });

  it('tests an object again once it is shown', () => {
    const g = buildGlobe();
    pruneGlobeHoverRaycasts(g.scene);
    g.graticules.visible = true;
    const spy = vi.spyOn(g.graticules, 'raycast');
    hits(g, 0, 0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reports no globe hit from inside the sphere or when it is behind the ray, as three.js does', () => {
    for (const setup of [
      (c: { position: { set(x: number, y: number, z: number): void } }) => c.position.set(0, 0, 50),
      (c: { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void }) => {
        c.position.set(0, 0, 300);
        c.lookAt(0, 0, 600);
      },
    ]) {
      const plain = buildGlobe();
      const pruned = buildGlobe();
      pruneGlobeHoverRaycasts(pruned.scene);
      for (const g of [plain, pruned]) {
        setup(g.camera);
        g.camera.updateMatrixWorld(true);
      }
      expect(reading(plain, hits(plain, 0, 0)).globePoint).toBeNull();
      expect(reading(pruned, hits(pruned, 0, 0)).globePoint).toBeNull();
    }
  });

  it('tests a sphere it does not recognise triangle by triangle, as before', () => {
    const g = buildGlobe();
    g.globe.material.side = THREE.DoubleSide;
    pruneGlobeHoverRaycasts(g.scene);
    const spy = vi.spyOn(g.globe, 'raycast');
    hits(g, -0.4, -0.3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('covers each globe once, and nothing in a scene without one', () => {
    const g = buildGlobe();
    expect(pruneGlobeHoverRaycasts(g.scene)).toBe(1);
    const first = g.root.raycast;
    expect(pruneGlobeHoverRaycasts(g.scene)).toBe(1);
    expect(g.root.raycast).toBe(first);
    expect(pruneGlobeHoverRaycasts(new THREE.Scene())).toBe(0);
    expect(pruneGlobeHoverRaycasts(undefined)).toBe(0);
  });
});

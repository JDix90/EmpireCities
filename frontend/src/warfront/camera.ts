/**
 * Warfront camera: pan and zoom over the terrain plane.
 *
 * World units are CELLS, matching the simulation's coordinate space, so a unit standing
 * at sim position (x, y) — 16.16 fixed, converted to a float for display only — is at
 * world (x, y) here with no second coordinate system to keep in sync.
 *
 * `x`/`y` are the world point at the CENTRE of the viewport, which makes clamping and
 * zoom-to-cursor symmetric in both axes. `scale` is screen pixels per cell.
 *
 * Pure functions, no PixiJS: this is the part worth unit-testing, and Pixi needs a GPU
 * context that jsdom does not provide.
 */

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface WorldSize {
  width: number;
  height: number;
}

/** Zooming in past this is pointless: a cell is already a fat block on screen. */
export const MAX_SCALE = 24;

/** Scale at which the whole grid just fits the viewport. Also the minimum zoom. */
export function fitScale(world: WorldSize, viewport: Viewport): number {
  if (world.width <= 0 || world.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(viewport.width / world.width, viewport.height / world.height);
}

/** Camera showing the entire grid, centred. */
export function fitCamera(world: WorldSize, viewport: Viewport): Camera {
  return clampCamera({ x: world.width / 2, y: world.height / 2, scale: fitScale(world, viewport) }, world, viewport);
}

/**
 * Keeps the grid filling the viewport where it can, and centred on any axis where the
 * grid is smaller than the viewport. Without the centring branch, a fitted camera on a
 * viewport of a different aspect ratio jams the map against one edge.
 */
export function clampCamera(camera: Camera, world: WorldSize, viewport: Viewport): Camera {
  const min = fitScale(world, viewport);
  const scale = Math.min(Math.max(camera.scale, min), MAX_SCALE);
  const halfW = viewport.width / scale / 2;
  const halfH = viewport.height / scale / 2;
  const x = halfW * 2 >= world.width ? world.width / 2 : Math.min(Math.max(camera.x, halfW), world.width - halfW);
  const y = halfH * 2 >= world.height ? world.height / 2 : Math.min(Math.max(camera.y, halfH), world.height - halfH);
  return { x, y, scale };
}

export function screenToWorld(camera: Camera, viewport: Viewport, sx: number, sy: number): { x: number; y: number } {
  return {
    x: camera.x + (sx - viewport.width / 2) / camera.scale,
    y: camera.y + (sy - viewport.height / 2) / camera.scale,
  };
}

export function worldToScreen(camera: Camera, viewport: Viewport, wx: number, wy: number): { x: number; y: number } {
  return {
    x: viewport.width / 2 + (wx - camera.x) * camera.scale,
    y: viewport.height / 2 + (wy - camera.y) * camera.scale,
  };
}

/** Pan by a screen-space drag delta, in pixels. */
export function panCamera(camera: Camera, world: WorldSize, viewport: Viewport, dxPx: number, dyPx: number): Camera {
  return clampCamera(
    { x: camera.x - dxPx / camera.scale, y: camera.y - dyPx / camera.scale, scale: camera.scale },
    world,
    viewport,
  );
}

/**
 * Zooms by `factor` about a screen point, keeping the world point under the cursor
 * pinned there — the behaviour every map tool has, and the reason zoom cannot just
 * multiply `scale` and leave the centre alone.
 */
export function zoomCameraAt(
  camera: Camera,
  world: WorldSize,
  viewport: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Camera {
  const anchor = screenToWorld(camera, viewport, screenX, screenY);
  const min = fitScale(world, viewport);
  const scale = Math.min(Math.max(camera.scale * factor, min), MAX_SCALE);
  return clampCamera(
    {
      x: anchor.x - (screenX - viewport.width / 2) / scale,
      y: anchor.y - (screenY - viewport.height / 2) / scale,
      scale,
    },
    world,
    viewport,
  );
}

/** Centres on a world point without changing zoom (the alerts' jump, later). */
export function centerOn(camera: Camera, world: WorldSize, viewport: Viewport, wx: number, wy: number): Camera {
  return clampCamera({ x: wx, y: wy, scale: camera.scale }, world, viewport);
}

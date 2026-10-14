/**
 * View math for the flat map's gestures (GameMap, `map_gestures_v2_enabled`).
 * Pure so the geometry is unit-testable without a canvas.
 *
 * The map's layers share one transform: a position (the content's top-left in
 * canvas pixels) and a uniform scale. Content coordinates run from 0 to the
 * canvas size at scale 1, so a content point p sits on screen at pos + p * scale.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** A content-space rectangle: where the land is drawn, at scale 1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MIN_MAP_SCALE = 0.3;
export const MAX_MAP_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.max(MIN_MAP_SCALE, Math.min(MAX_MAP_SCALE, scale));
}

/**
 * The position that keeps the content point under `focus` (canvas pixels)
 * fixed while the scale changes from `scale` to `nextScale`.
 */
export function zoomAbout(pos: Point, scale: number, nextScale: number, focus: Point): Point {
  const ratio = nextScale / scale;
  return {
    x: focus.x - (focus.x - pos.x) * ratio,
    y: focus.y - (focus.y - pos.y) * ratio,
  };
}

export interface PinchStart {
  /** Midpoint of the two fingers, canvas pixels. */
  mid: Point;
  /** Distance between the fingers. */
  dist: number;
  pos: Point;
  scale: number;
}

/**
 * A pinch from `start` to the fingers' current midpoint and distance. The
 * content point that was between the fingers stays between them, so the map
 * zooms around the fingers and follows them when they move together.
 */
export function pinchView(start: PinchStart, mid: Point, dist: number): { pos: Point; scale: number } {
  const scale = clampScale(start.scale * (start.dist > 0 ? dist / start.dist : 1));
  const content = {
    x: (start.mid.x - start.pos.x) / start.scale,
    y: (start.mid.y - start.pos.y) / start.scale,
  };
  return { pos: { x: mid.x - content.x * scale, y: mid.y - content.y * scale }, scale };
}

/**
 * Keep at least `margin` pixels of the land on screen on each axis, so a pan
 * or a zoom can never leave a blank canvas. `land` is where the territories
 * are drawn at scale 1, which on most maps is well inside the canvas: bounding
 * the canvas-sized content instead still let the land slide out of view. The
 * canvas is `view`.
 */
export function clampPan(pos: Point, scale: number, view: Size, land: Box, margin: number): Point {
  const clampAxis = (p: number, viewLen: number, lo: number, hi: number) => {
    const scaled = (hi - lo) * scale;
    const keep = Math.min(margin, scaled, viewLen);
    // The land's far edge stays `keep` px inside the near side of the canvas,
    // and its near edge `keep` px inside the far side.
    const min = keep - hi * scale;
    const max = viewLen - keep - lo * scale;
    return Math.max(min, Math.min(max, p));
  };
  return { x: clampAxis(pos.x, view.w, land.x0, land.x1), y: clampAxis(pos.y, view.h, land.y0, land.y1) };
}

/** How much land stays on screen: a quarter of the canvas, at most 96px. */
export function panMargin(view: Size): number {
  return Math.min(96, view.w / 4, view.h / 4);
}

/** A press that lifts within this long, having moved less than TAP_SLOP, is a tap. */
export const TAP_MS = 300;
export const TAP_SLOP = 10;
/** Two taps this close in time and space are a double-tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 40;

export interface TapRecord {
  at: number;
  point: Point;
}

/** Whether `tap` completes a double-tap begun by `previous`. */
export function isDoubleTap(previous: TapRecord | null, tap: TapRecord): boolean {
  if (!previous) return false;
  return (
    tap.at - previous.at < DOUBLE_TAP_MS &&
    Math.hypot(tap.point.x - previous.point.x, tap.point.y - previous.point.y) < DOUBLE_TAP_SLOP
  );
}

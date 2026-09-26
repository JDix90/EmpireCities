/**
 * Draws a single condensed-replay frame onto a 2D canvas for video/GIF export.
 *
 * We deliberately render our own branded board instead of capturing the live
 * PixiJS/three.js WebGL surface — that avoids `preserveDrawingBuffer` capture
 * pain and keeps the exported clip clean, consistent, and on-brand across
 * aspect ratios.
 *
 * The board is drawn as a GLOBE whenever real lon/lat geometry is available
 * (`ClipMapData.globe`), matching what players actually look at. The flat
 * fallback below draws each territory's authored `polygon` — the blocky seed
 * rectangles from map authoring — and is reached only by maps with no globe
 * geometry at all, such as the galaxy boards.
 */
import {
  globeRadiusPx,
  projectRing,
  type ClipGlobeCamera,
  type ClipGlobeViewport,
} from './clipGlobeProjection';
import { decimateRing } from './clipGlobeData';

export interface ClipMapTerritory {
  territory_id: string;
  polygon?: number[][];
}

/** One territory's real geometry, as outer lon/lat rings. */
export interface ClipGlobeTerritory {
  territory_id: string;
  rings: [number, number][][];
}

export interface ClipGlobeData {
  territories: ClipGlobeTerritory[];
  /** Where the camera looks, and how much of the sphere it must cover. */
  camera: ClipGlobeCamera;
  /** The map locks the live globe's rotation (regional theaters); its clip camera never moves either. */
  lockRotation?: boolean;
}

export interface ClipMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: ClipMapTerritory[];
  /** Present when the map resolves to real globe geometry; see buildClipGlobeData. */
  globe?: ClipGlobeData | null;
  /** Space Age: the Moon's tiles, drawn as an inset in the corner of the globe board. */
  moon?: ClipGlobeData | null;
}

export interface ClipPlayer {
  player_id: string;
  username: string;
  color: string;
  territory_count: number;
  is_eliminated: boolean;
}

export interface ClipFrameState {
  turn_number: number;
  phase?: string;
  players: ClipPlayer[];
  territories: Record<string, { owner_id: string | null }>;
}

export interface DrawClipFrameOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  mapData: ClipMapData;
  state: ClipFrameState;
  eraLabel: string;
  caption: string;
  /** 0..1 playback progress for the bottom bar. */
  progress: number;
  /**
   * Where the globe camera looks in this frame; the board's own framing when
   * omitted. Set by the clip's camera plan (see clipCameraDirector).
   */
  camera?: ClipGlobeCamera;
  /** The camera is mid-turn: draw simplified coastlines, which the motion hides. */
  cameraMoving?: boolean;
  /** The Moon inset's camera; its own opening view when omitted. */
  moonCamera?: ClipGlobeCamera;
  moonCameraMoving?: boolean;
  /**
   * Moon tiles that changed hands in this moment. When there are any the inset
   * grows, takes a gold rim and outlines them in gold.
   */
  moonCaptured?: readonly string[];
}

const BG_TOP = '#101724';
const BG_MID = '#1b2335';
const BG_BOT = '#0a0f18';
const GOLD = '#c9a84c';
const NEUTRAL = '#2a3346';
// Ocean + rim, picked to sit beside the blue-marble globe the app renders
// rather than to match it pixel for pixel — a flat wash reads cleaner than a
// texture once the frame is down at GIF resolution.
const OCEAN_LIT = '#1d3a5c';
const OCEAN_DEEP = '#08111f';
const GLOBE_RIM = 'rgba(130,190,255,0.55)';
// The Moon inset: grey regolith rather than ocean. Unclaimed tiles are left
// unfilled, so they read as bare surface rather than Earth's navy sea.
const MOON_LIT = '#a4a4ab';
const MOON_DEEP = '#2b2b31';
const MOON_RIM = 'rgba(225,225,235,0.55)';
/** Inset radius as a share of the board box's short side: resting, and while its fighting is on screen. */
const MOON_INSET_SHARE = 0.13;
const MOON_INSET_ACTIVE_SHARE = 0.17;

const NONE_OUTLINED: ReadonlySet<string> = new Set();

interface SpherePalette {
  lit: string;
  deep: string;
  rim: string;
  /**
   * Opacity of owner colors over the surface. Earth's are solid; the Moon's let
   * the regolith show through, or one empire's tiles turn it into a flat disc.
   */
  fillAlpha: number;
  border: string;
}
const EARTH_PALETTE: SpherePalette = { lit: OCEAN_LIT, deep: OCEAN_DEEP, rim: GLOBE_RIM, fillAlpha: 1, border: 'rgba(0,0,0,0.45)' };
const MOON_PALETTE: SpherePalette = { lit: MOON_LIT, deep: MOON_DEEP, rim: MOON_RIM, fillAlpha: 0.72, border: 'rgba(0,0,0,0.6)' };
/** How far the globe may overflow the board box's short edge. See drawGlobeBoard. */
const BOARD_HEIGHT_STRETCH = 1.3;

function polygonBounds(mapData: ClipMapData): { minX: number; minY: number; w: number; h: number } {
  if (mapData.canvas_width && mapData.canvas_height) {
    return { minX: 0, minY: 0, w: mapData.canvas_width, h: mapData.canvas_height };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of mapData.territories) {
    for (const [x, y] of t.polygon ?? []) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 1, h: 1 };
  return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function drawClipFrame(opts: DrawClipFrameOptions): void {
  const {
    ctx,
    width: W,
    height: H,
    mapData,
    state,
    eraLabel,
    caption,
    progress,
    camera,
    cameraMoving,
    moonCamera,
    moonCameraMoving,
    moonCaptured,
  } = opts;

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(0.55, BG_MID);
  grad.addColorStop(1, BG_BOT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const pad = Math.round(W * 0.04);
  const headerH = Math.round(H * 0.13);
  const footerH = Math.round(H * 0.2);
  const mapTop = headerH;
  const mapBottom = H - footerH;
  const mapLeft = pad;
  const mapRight = W - pad;
  const mapW = mapRight - mapLeft;
  const mapH = mapBottom - mapTop;

  // ── Header ──────────────────────────────────────────────────────────────
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, W, Math.max(4, Math.round(H * 0.008)));
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `700 ${Math.round(H * 0.045)}px Georgia, serif`;
  ctx.fillText('Borderfall', pad, Math.round(headerH * 0.58));
  ctx.fillStyle = GOLD;
  ctx.font = `${Math.round(H * 0.026)}px system-ui, sans-serif`;
  ctx.fillText(`${eraLabel} · Turn ${state.turn_number}`, pad, Math.round(headerH * 0.88));

  // ── Map ─────────────────────────────────────────────────────────────────
  const playerColor = new Map<string, string>();
  for (const p of state.players) playerColor.set(p.player_id, p.color);
  const ownerColor = (territoryId: string): string => {
    const owner = state.territories[territoryId]?.owner_id ?? null;
    return owner ? (playerColor.get(owner) ?? NEUTRAL) : NEUTRAL;
  };

  const box = { left: mapLeft, top: mapTop, width: mapW, height: mapH };
  const drewAny = mapData.globe
    ? drawGlobeBoard(ctx, W, mapData.globe, box, ownerColor, camera ?? mapData.globe.camera, cameraMoving === true, EARTH_PALETTE)
    : drawFlatBoard(ctx, W, mapData, box, ownerColor);

  if (drewAny && mapData.globe && mapData.moon) {
    // Unclaimed lunar tiles show bare regolith rather than Earth's navy.
    const moonOwnerColor = (territoryId: string): string | null => {
      const owner = state.territories[territoryId]?.owner_id ?? null;
      return owner ? (playerColor.get(owner) ?? null) : null;
    };
    drawMoonInset(
      ctx,
      W,
      H,
      mapData.moon,
      box,
      moonOwnerColor,
      moonCamera ?? mapData.moon.camera,
      moonCameraMoving === true,
      new Set(moonCaptured ?? []),
    );
  }

  // Caption (reason) — anchored just below the map for any map kind.
  if (caption) {
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `600 ${Math.round(H * 0.03)}px system-ui, sans-serif`;
    ctx.fillText(caption, W / 2, mapBottom + Math.round(footerH * 0.28));
  }

  if (!drewAny) {
    // Galaxy / geometry-less maps: show a neutral note instead of a blank board.
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(H * 0.03)}px system-ui, sans-serif`;
    ctx.fillText('Empire standings', W / 2, mapTop + mapH / 2);
  }

  // ── Footer: standings bar ────────────────────────────────────────────────
  const standings = [...state.players]
    .sort((a, b2) => b2.territory_count - a.territory_count)
    .slice(0, 6);
  const totalTerr = standings.reduce((s, p) => s + Math.max(0, p.territory_count), 0) || 1;
  const barY = footerBarY(H, footerH);
  const barH = Math.round(H * 0.018);
  let cursor = pad;
  const barW = W - pad * 2;
  for (const p of standings) {
    const seg = Math.max(2, (Math.max(0, p.territory_count) / totalTerr) * barW);
    ctx.fillStyle = p.is_eliminated ? 'rgba(255,255,255,0.12)' : p.color;
    ctx.fillRect(cursor, barY, seg, barH);
    cursor += seg;
  }

  // Legend chips under the bar
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(H * 0.022)}px system-ui, sans-serif`;
  const chipY = barY + barH + Math.round(H * 0.04);
  let chipX = pad;
  for (const p of standings) {
    const dot = Math.round(H * 0.014);
    ctx.fillStyle = p.is_eliminated ? 'rgba(255,255,255,0.2)' : p.color;
    ctx.beginPath();
    ctx.arc(chipX + dot, chipY - dot * 0.4, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.is_eliminated ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
    const label = `${p.username} ${p.territory_count}`;
    ctx.fillText(label, chipX + dot * 2.6, chipY);
    chipX += ctx.measureText(label).width + dot * 5;
    if (chipX > W - pad * 3) break;
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, H - Math.round(H * 0.01), W, Math.round(H * 0.01));
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, H - Math.round(H * 0.01), W * Math.min(1, Math.max(0, progress)), Math.round(H * 0.01));
}

function footerBarY(H: number, footerH: number): number {
  return H - footerH + Math.round(footerH * 0.42);
}

interface BoardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A territory's coastline, already projected into canvas space. */
interface PreparedShape {
  territoryId: string;
  /** Replayable path; null where Path2D is unavailable (jsdom), see `points`. */
  path: Path2D | null;
  points: [number, number][][];
}

interface PreparedGlobeBoard {
  /** The board box and camera this was projected for; a change to either reprojects. */
  key: string;
  view: ClipGlobeViewport;
  shapes: PreparedShape[];
}

/**
 * Projection only changes when the camera does. It holds still for most of a
 * clip (all of it, on a map it has no need to turn for) and only the owner
 * colors change meanwhile, so every held frame replays cached paths.
 *
 * Filling the coastline, not projecting it, is what a frame costs. Measured in
 * headless Chromium at 720x1280 on the WWII map (~46k vertices): the very first
 * frame takes ~46ms while everything warms up, then a held frame ~20ms and
 * reprojecting to a new view only ~1ms more. A 30fps MediaRecorder capture has
 * 33ms, and a slower device misses it on every frame. During a hold that is
 * invisible (the dropped frame is identical to the one kept); during a turn it
 * shows as stutter. So turning frames draw the coarse outlines below, about
 * half the cost of a held frame, and are not cached; full detail returns once
 * the camera settles.
 *
 * A few views are kept per board: a clip holds on several, and the exporter can
 * be run again for another aspect.
 */
const PREPARED_VIEWS_KEPT = 4;
const preparedBoards = new WeakMap<ClipGlobeData, PreparedGlobeBoard[]>();

/**
 * Outlines for a turning camera: each territory's largest rings, thinned hard.
 * Motion hides the lost detail, and far fewer vertices make the frame far
 * cheaper to fill.
 */
const COARSE_RINGS_PER_TERRITORY = 4;
const COARSE_RING_POINTS = 60;
const coarseOutlines = new WeakMap<ClipGlobeData, ClipGlobeTerritory[]>();

function coarseTerritories(globe: ClipGlobeData): ClipGlobeTerritory[] {
  let coarse = coarseOutlines.get(globe);
  if (!coarse) {
    coarse = globe.territories.map((t) => ({
      territory_id: t.territory_id,
      // Rings arrive largest first (see buildClipGlobeData).
      rings: t.rings.slice(0, COARSE_RINGS_PER_TERRITORY).map((ring) => decimateRing(ring, COARSE_RING_POINTS)),
    }));
    coarseOutlines.set(globe, coarse);
  }
  return coarse;
}

function prepareGlobeBoard(
  globe: ClipGlobeData,
  box: BoardBox,
  camera: ClipGlobeCamera,
  turning: boolean,
): PreparedGlobeBoard | null {
  // The sphere is round but the frame is not. Letting the disc run past the
  // short edge (it is clipped to the board box either way) fills a 1:1 or 16:9
  // clip properly instead of leaving a small coin in a wide letterbox; the poles
  // it trims are empty ocean at every framing the maps actually use.
  const fit = Math.min(box.width, box.height * BOARD_HEIGHT_STRETCH) / 2;
  if (fit <= 0) return null;
  const view: ClipGlobeViewport = {
    cx: box.left + box.width / 2,
    cy: box.top + box.height / 2,
    radius: globeRadiusPx(camera, fit),
  };
  const key = `${box.left}:${box.top}:${box.width}:${box.height}|${camera.centerLng}:${camera.centerLat}:${camera.angularRadiusDeg}`;

  const kept = preparedBoards.get(globe) ?? [];
  if (!turning) {
    const cached = kept.find((b) => b.key === key);
    if (cached) return cached;
  }

  const canPath = typeof Path2D !== 'undefined';
  const shapes: PreparedShape[] = [];
  for (const t of turning ? coarseTerritories(globe) : globe.territories) {
    const points: [number, number][][] = [];
    for (const ring of t.rings) {
      const pts = projectRing(ring, camera, view);
      if (pts) points.push(pts);
    }
    if (points.length === 0) continue;
    let path: Path2D | null = null;
    if (canPath) {
      path = new Path2D();
      for (const pts of points) {
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
        path.closePath();
      }
    }
    shapes.push({ territoryId: t.territory_id, path, points });
  }

  const prepared: PreparedGlobeBoard = { key, view, shapes };
  // Mid-turn views never repeat; caching them would only evict the ones the
  // camera is about to hold on.
  if (!turning) preparedBoards.set(globe, [prepared, ...kept].slice(0, PREPARED_VIEWS_KEPT));
  return prepared;
}

/**
 * Hand `paint` the shape's cached Path2D, or, where Path2D is unavailable
 * (jsdom), trace each ring as the current path and call it once per ring.
 */
function paintShape(
  ctx: CanvasRenderingContext2D,
  shape: PreparedShape,
  paint: (path: Path2D | null) => void,
): void {
  if (shape.path) {
    paint(shape.path);
    return;
  }
  for (const pts of shape.points) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    paint(null);
  }
}

/**
 * Globe board: the real lon/lat geometry, orthographically projected.
 *
 * Draw order is ocean disc → territories (clipped to the disc) → shading →
 * rim. The clip is what lets a territory straddling the horizon be filled
 * generously and still stop exactly at the edge of the world.
 */
function drawGlobeBoard(
  ctx: CanvasRenderingContext2D,
  W: number,
  globe: ClipGlobeData,
  box: BoardBox,
  ownerColor: (territoryId: string) => string | null,
  camera: ClipGlobeCamera,
  turning: boolean,
  palette: SpherePalette,
  outlined: ReadonlySet<string> = NONE_OUTLINED,
): boolean {
  if (globe.territories.length === 0) return false;
  const prepared = prepareGlobeBoard(globe, box, camera, turning);
  if (!prepared || prepared.shapes.length === 0) return false;
  const { view, shapes } = prepared;
  const radius = view.radius;

  ctx.save();
  // Everything the sphere draws stays inside the sphere. The disc can be far
  // larger than the frame when the camera is zoomed into a regional theater,
  // so the board box bounds it too.
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, radius, 0, Math.PI * 2);
  ctx.clip();

  /**
   * Lighting radius. The disc itself is the right scale for a world view, but
   * a regional theater sits on a sphere several frame-widths across — anchoring
   * the light to that puts both the highlight and the terminator off-screen and
   * leaves a lopsided dark band cutting through the frame. Clamping to the
   * frame keeps a zoomed-in board lit like the sphere it is a patch of.
   */
  const lightR = Math.min(radius, Math.hypot(box.width, box.height) * 0.62);
  const lightX = view.cx - lightR * 0.35;
  const lightY = view.cy - lightR * 0.4;

  // Ocean, lit from the upper left so the disc reads as a sphere and not a coin.
  const ocean = ctx.createRadialGradient(lightX, lightY, lightR * 0.05, view.cx, view.cy, lightR);
  ocean.addColorStop(0, palette.lit);
  ocean.addColorStop(1, palette.deep);
  ctx.fillStyle = ocean;
  ctx.fillRect(view.cx - radius, view.cy - radius, radius * 2, radius * 2);

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.6, W * 0.001);
  ctx.strokeStyle = palette.border;
  for (const shape of shapes) {
    const fill = ownerColor(shape.territoryId);
    paintShape(ctx, shape, (path) => {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.globalAlpha = palette.fillAlpha;
        if (path) ctx.fill(path);
        else ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (path) ctx.stroke(path);
      else ctx.stroke();
    });
  }
  if (outlined.size > 0) {
    ctx.lineWidth = Math.max(1.5, W * 0.003);
    ctx.strokeStyle = GOLD;
    for (const shape of shapes) {
      if (!outlined.has(shape.territoryId)) continue;
      paintShape(ctx, shape, (path) => {
        if (path) ctx.stroke(path);
        else ctx.stroke();
      });
    }
  }

  // Curvature pass over the land too, otherwise the territories read flat
  // while only the ocean around them looks spherical.
  const shade = ctx.createRadialGradient(lightX, lightY, lightR * 0.1, view.cx, view.cy, lightR);
  shade.addColorStop(0, 'rgba(255,255,255,0.14)');
  shade.addColorStop(0.55, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(view.cx - radius, view.cy - radius, radius * 2, radius * 2);
  ctx.restore();

  // Rim light, drawn outside the clip so it is not cut in half by its own edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.width, box.height);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, W * 0.0025);
  ctx.strokeStyle = palette.rim;
  ctx.stroke();
  ctx.restore();

  return true;
}

/**
 * The Moon, in the bottom-right corner of the globe board — where the live game
 * parks its own Moon inset, so a Space Age clip reads like the board it came
 * from. Drawn over Earth's rim on a dark backing disc so the two spheres stay
 * distinct. In a moment where a Moon tile changes hands it grows toward the
 * middle and takes a gold rim, since otherwise a capture on a disc this small
 * is easy to miss.
 */
function drawMoonInset(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  moon: ClipGlobeData,
  box: BoardBox,
  ownerColor: (territoryId: string) => string | null,
  camera: ClipGlobeCamera,
  turning: boolean,
  captured: ReadonlySet<string>,
): void {
  const active = captured.size > 0;
  const r = Math.round(Math.min(box.width, box.height) * (active ? MOON_INSET_ACTIVE_SHARE : MOON_INSET_SHARE));
  if (r < 8) return;
  const margin = Math.round(W * 0.02);
  const inset: BoardBox = {
    left: box.left + box.width - margin - r * 2,
    top: box.top + box.height - margin - r * 2,
    width: r * 2,
    height: r * 2,
  };
  const cx = inset.left + r;
  const cy = inset.top + r;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + Math.max(2, r * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(5,8,14,0.9)';
  ctx.fill();
  ctx.restore();

  if (!drawGlobeBoard(ctx, W, moon, inset, ownerColor, camera, turning, MOON_PALETTE, captured)) return;

  if (active) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + Math.max(2, r * 0.05), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.restore();
  }

  // The label sits over Earth's rim, so it gets a dark tag of its own.
  ctx.save();
  const fontPx = Math.max(9, Math.round(H * 0.018));
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelW = ctx.measureText('MOON').width + fontPx;
  const labelH = Math.round(fontPx * 1.5);
  const labelY = inset.top - Math.max(4, Math.round(r * 0.1)) - labelH / 2;
  ctx.fillStyle = 'rgba(5,8,14,0.85)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(cx - labelW / 2, labelY - labelH / 2, labelW, labelH, labelH / 2);
  else ctx.rect(cx - labelW / 2, labelY - labelH / 2, labelW, labelH);
  ctx.fill();
  ctx.fillStyle = active ? GOLD : 'rgba(255,255,255,0.75)';
  ctx.fillText('MOON', cx, labelY + 0.5);
  ctx.restore();
}

/**
 * Flat board: each territory's authored canvas polygon. Only maps with no
 * globe geometry reach this — galaxy boards and anything whose geo sources
 * failed to load.
 */
function drawFlatBoard(
  ctx: CanvasRenderingContext2D,
  W: number,
  mapData: ClipMapData,
  box: BoardBox,
  ownerColor: (territoryId: string) => string,
): boolean {
  const b = polygonBounds(mapData);
  const scale = Math.min(box.width / b.w, box.height / b.h);
  const offX = box.left + (box.width - b.w * scale) / 2;
  const offY = box.top + (box.height - b.h * scale) / 2;
  const tx = (x: number) => offX + (x - b.minX) * scale;
  const ty = (y: number) => offY + (y - b.minY) * scale;

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.75, W * 0.0012);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  let drewAny = false;
  for (const t of mapData.territories) {
    const poly = t.polygon;
    if (!poly || poly.length < 3) continue;
    drewAny = true;
    ctx.beginPath();
    ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0]), ty(poly[i][1]));
    ctx.closePath();
    ctx.fillStyle = ownerColor(t.territory_id);
    ctx.fill();
    ctx.stroke();
  }
  return drewAny;
}

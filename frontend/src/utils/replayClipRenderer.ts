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
}

export interface ClipMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: ClipMapTerritory[];
  /** Present when the map resolves to real globe geometry; see buildClipGlobeData. */
  globe?: ClipGlobeData | null;
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
  const { ctx, width: W, height: H, mapData, state, eraLabel, caption, progress } = opts;

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
    ? drawGlobeBoard(ctx, W, mapData.globe, box, ownerColor)
    : drawFlatBoard(ctx, W, mapData, box, ownerColor);

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
  /** The board box this was projected for; a different frame size reprojects. */
  key: string;
  view: ClipGlobeViewport;
  shapes: PreparedShape[];
}

/**
 * Projection is frame-invariant — the camera never moves during a clip and only
 * the owner colors change — so every frame after the first replays cached
 * paths.
 *
 * This is not a micro-optimization. A world map carries ~46k coastline
 * vertices and four trig calls apiece; reprojecting per frame measured 46ms at
 * 720x1280, which is past the 33ms a 30fps MediaRecorder capture has to spend,
 * so the recorded video visibly dropped frames.
 */
const preparedBoards = new WeakMap<ClipGlobeData, PreparedGlobeBoard>();

function prepareGlobeBoard(globe: ClipGlobeData, box: BoardBox): PreparedGlobeBoard | null {
  // The sphere is round but the frame is not. Letting the disc run past the
  // short edge (it is clipped to the board box either way) fills a 1:1 or 16:9
  // clip properly instead of leaving a small coin in a wide letterbox; the poles
  // it trims are empty ocean at every framing the maps actually use.
  const fit = Math.min(box.width, box.height * BOARD_HEIGHT_STRETCH) / 2;
  if (fit <= 0) return null;
  const view: ClipGlobeViewport = {
    cx: box.left + box.width / 2,
    cy: box.top + box.height / 2,
    radius: globeRadiusPx(globe.camera, fit),
  };
  const key = `${box.left}:${box.top}:${box.width}:${box.height}`;

  const cached = preparedBoards.get(globe);
  if (cached && cached.key === key) return cached;

  const canPath = typeof Path2D !== 'undefined';
  const shapes: PreparedShape[] = [];
  for (const t of globe.territories) {
    const points: [number, number][][] = [];
    for (const ring of t.rings) {
      const pts = projectRing(ring, globe.camera, view);
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
  preparedBoards.set(globe, prepared);
  return prepared;
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
  ownerColor: (territoryId: string) => string,
): boolean {
  if (globe.territories.length === 0) return false;
  const prepared = prepareGlobeBoard(globe, box);
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
  ocean.addColorStop(0, OCEAN_LIT);
  ocean.addColorStop(1, OCEAN_DEEP);
  ctx.fillStyle = ocean;
  ctx.fillRect(view.cx - radius, view.cy - radius, radius * 2, radius * 2);

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.6, W * 0.001);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  for (const shape of shapes) {
    ctx.fillStyle = ownerColor(shape.territoryId);
    if (shape.path) {
      ctx.fill(shape.path);
      ctx.stroke(shape.path);
      continue;
    }
    for (const pts of shape.points) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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
  ctx.strokeStyle = GLOBE_RIM;
  ctx.stroke();
  ctx.restore();

  return true;
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

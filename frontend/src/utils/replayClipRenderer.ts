/**
 * Draws a single condensed-replay frame onto a 2D canvas for video/GIF export.
 *
 * We deliberately render our own branded 2D board (filled territory polygons
 * colored by owner) instead of capturing the live PixiJS/three.js WebGL
 * surface — that avoids `preserveDrawingBuffer` capture pain and keeps the
 * exported clip clean, consistent, and on-brand across aspect ratios.
 */

export interface ClipMapTerritory {
  territory_id: string;
  polygon?: number[][];
}

export interface ClipMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: ClipMapTerritory[];
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

  const b = polygonBounds(mapData);
  const scale = Math.min(mapW / b.w, mapH / b.h);
  const drawW = b.w * scale;
  const drawH = b.h * scale;
  const offX = mapLeft + (mapW - drawW) / 2;
  const offY = mapTop + (mapH - drawH) / 2;
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
    const owner = state.territories[t.territory_id]?.owner_id ?? null;
    const color = owner ? (playerColor.get(owner) ?? NEUTRAL) : NEUTRAL;
    ctx.beginPath();
    ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
    for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0]), ty(poly[i][1]));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
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

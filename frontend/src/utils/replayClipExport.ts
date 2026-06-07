/**
 * Renders a condensed replay timeline to a downloadable/shareable clip.
 *
 * Video: a real-time `MediaRecorder` capture of an offscreen 2D canvas
 * (`canvas.captureStream`). GIF: frame-by-frame encoding with `gifenc`.
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { drawClipFrame, type ClipFrameState, type ClipMapData } from './replayClipRenderer';
import type { CondensedFrame } from './replayCondense';
import { condenseReasonLabel } from './replayCondense';

export type ClipAspect = '16:9' | '9:16' | '1:1';
export type ClipFormat = 'video' | 'gif';

const VIDEO_DIMS: Record<ClipAspect, { w: number; h: number }> = {
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 1080, h: 1080 },
};

// GIFs balloon fast, so encode at a smaller resolution.
const GIF_DIMS: Record<ClipAspect, { w: number; h: number }> = {
  '16:9': { w: 480, h: 270 },
  '9:16': { w: 360, h: 640 },
  '1:1': { w: 480, h: 480 },
};

const MIN_CLIP_MS = 6000;
const MAX_CLIP_MS = 20000;

export interface ClipExportInput {
  frames: CondensedFrame[];
  snapshots: ClipFrameState[];
  mapData: ClipMapData;
  eraLabel: string;
  aspect: ClipAspect;
  onProgress?: (p: number) => void;
}

interface FramePlan {
  state: ClipFrameState;
  caption: string;
  durationMs: number;
}

/** Scale the condensed dwell times so the whole clip fits a share-friendly length. */
function buildFramePlan(frames: CondensedFrame[], snapshots: ClipFrameState[]): { plan: FramePlan[]; totalMs: number } {
  const valid = frames.filter((f) => snapshots[f.index]);
  const rawTotal = valid.reduce((s, f) => s + f.dwellMs, 0) || 1;
  const clamped = Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, rawTotal));
  const factor = clamped / rawTotal;
  const plan = valid.map((f) => ({
    state: snapshots[f.index],
    caption: condenseReasonLabel(f.reason),
    durationMs: Math.max(250, Math.round(f.dwellMs * factor)),
  }));
  const totalMs = plan.reduce((s, p) => s + p.durationMs, 0);
  return { plan, totalMs };
}

/** Feature-detect the best supported recording container. Null if unsupported. */
export function pickVideoMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return null;
}

export interface ClipResult {
  blob: Blob;
  ext: string;
  mime: string;
}

export async function exportClipVideo(input: ClipExportInput): Promise<ClipResult> {
  const picked = pickVideoMime();
  if (!picked) throw new Error('Video recording is not supported in this browser. Try GIF instead.');

  const { w, h } = VIDEO_DIMS[input.aspect];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing context.');

  const { plan, totalMs } = buildFramePlan(input.frames, input.snapshots);
  if (plan.length === 0) throw new Error('Nothing to export.');

  // Cumulative start times so the rAF loop can map elapsed → current frame.
  const starts: number[] = [];
  let acc = 0;
  for (const p of plan) {
    starts.push(acc);
    acc += p.durationMs;
  }

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: picked.mime }));
  });

  // Draw the first frame before starting so the stream opens with content.
  drawClipFrame({ ctx, width: w, height: h, mapData: input.mapData, state: plan[0].state, eraLabel: input.eraLabel, caption: plan[0].caption, progress: 0 });
  recorder.start();

  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      // Find the current frame for this timestamp.
      let idx = 0;
      for (let i = 0; i < starts.length; i++) {
        if (elapsed >= starts[i]) idx = i;
      }
      const p = plan[idx];
      drawClipFrame({
        ctx,
        width: w,
        height: h,
        mapData: input.mapData,
        state: p.state,
        eraLabel: input.eraLabel,
        caption: p.caption,
        progress: Math.min(1, elapsed / totalMs),
      });
      input.onProgress?.(Math.min(1, elapsed / totalMs));
      if (elapsed >= totalMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Flush any tail data then stop.
  recorder.stop();
  const blob = await finished;
  return { blob, ext: picked.ext, mime: picked.mime };
}

export async function exportClipGif(input: ClipExportInput): Promise<ClipResult> {
  const { w, h } = GIF_DIMS[input.aspect];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a drawing context.');

  const { plan, totalMs } = buildFramePlan(input.frames, input.snapshots);
  if (plan.length === 0) throw new Error('Nothing to export.');

  const gif = GIFEncoder();
  let elapsed = 0;
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    drawClipFrame({
      ctx,
      width: w,
      height: h,
      mapData: input.mapData,
      state: p.state,
      eraLabel: input.eraLabel,
      caption: p.caption,
      progress: totalMs ? elapsed / totalMs : 0,
    });
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay: p.durationMs });
    elapsed += p.durationMs;
    input.onProgress?.((i + 1) / plan.length);
    // Yield so the UI/progress bar can update between frames.
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  // `gif.bytes()` is a Uint8Array; cast to BlobPart to sidestep the lib's
  // SharedArrayBuffer-vs-ArrayBuffer typing on Uint8Array.
  const blob = new Blob([gif.bytes() as unknown as BlobPart], { type: 'image/gif' });
  return { blob, ext: 'gif', mime: 'image/gif' };
}

/** Trigger a browser download for a generated clip. */
export function downloadClip(result: ClipResult, baseName: string): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${result.ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share a clip via the Web Share API (files), when available. Returns false if unsupported. */
export async function shareClipFile(result: ClipResult, baseName: string, text: string): Promise<boolean> {
  const file = new File([result.blob], `${baseName}.${result.ext}`, { type: result.mime });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return true;
    } catch {
      return false; // user cancelled
    }
  }
  return false;
}

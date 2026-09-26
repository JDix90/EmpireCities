/**
 * Plans where an exported replay clip's globe camera looks, moment by moment.
 *
 * A clip used to frame the whole board once and hold that view for its full
 * length. A regional theater fits in one view, but a world map spans more than
 * the hemisphere an orthographic globe can show, so everything fought on the
 * far side of the planet never appeared in the clip at all.
 *
 * The whole replay is known before a frame is drawn, so the camera is planned
 * like an edit rather than chased: for each moment, find the territories that
 * changed hands, turn toward them, and arrive as their colors flip. Maps the
 * fixed view already covers get no plan and keep today's framing exactly.
 *
 * Pure planning only. The exporters ask {@link clipCameraAt} for the camera at
 * a timestamp; the renderer draws whatever camera it is handed.
 */
import type { ClipGlobeCamera } from './clipGlobeProjection';
import type { ClipFrameState, ClipGlobeData } from './replayClipRenderer';

const DEG = Math.PI / 180;

/**
 * A territory further than this from the clip's framing sits on the rim or
 * behind it (sin 75° = 0.97 of the disc radius), where the fixed view cannot
 * show it — so the board needs a camera that moves.
 */
const FOLLOW_TRIGGER_DEG = 75;
/** Action within this of the camera center counts as shown: in view, and not squashed against the rim. */
const COVER_DEG = 55;
/** Turns shorter than this are skipped: the action is already near the middle, and a nudge reads as jitter. */
const MIN_TURN_DEG = 25;
/** Travel time is a base plus a share per half-turn, so a long swing takes longer without dragging. */
const TRAVEL_BASE_MS = 450;
const TRAVEL_PER_180_MS = 700;
/**
 * The camera sets off during the previous moment so it arrives as the colors
 * change, spending at most this share of that moment; whatever travel is left
 * runs into the new moment, up to this share of it.
 */
const LEAD_SHARE = 0.6;
const LAG_SHARE = 0.5;
/**
 * After arriving, the camera rests at least this long before setting off
 * again (where the moments are long enough to allow it), so each result is
 * seen standing still. Fronts that alternate every moment otherwise leave it
 * swinging without a pause.
 */
const REST_MS = 300;

/** GIF in-between frames: about one per this many ms of turning. */
const GIF_TWEEN_MS = 90;
const GIF_MIN_TWEENS_PER_TURN = 2;
const GIF_MAX_TWEENS_PER_TURN = 6;
/** Every in-between frame is a full GIF frame, so the clip as a whole gets a budget. */
const GIF_TWEEN_BUDGET = 48;

export interface GlobeCenter {
  lng: number;
  lat: number;
}

/** One camera turn, in clip time. */
export interface ClipCameraTurn {
  /** Plan step whose change this turn arrives for. */
  stepIndex: number;
  startMs: number;
  /** When that step begins and its territories change color. */
  arriveMs: number;
  endMs: number;
  from: GlobeCenter;
  to: GlobeCenter;
}

export interface ClipCameraPath {
  /** The opening view, and the zoom every frame keeps. */
  base: ClipGlobeCamera;
  /** In time order, never overlapping. */
  turns: ClipCameraTurn[];
}

/** One held moment of the clip: the board it shows and for how long. */
export interface ClipCameraStep {
  state: ClipFrameState;
  durationMs: number;
}

type Vec3 = [number, number, number];

function unitVector(lng: number, lat: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lng * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function normalized(v: Vec3): Vec3 | null {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n < 1e-9 ? null : [v[0] / n, v[1] / n, v[2] / n];
}

function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

function toCenter(v: Vec3): GlobeCenter {
  return {
    lng: Math.atan2(v[1], v[0]) / DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
  };
}

/** The mean direction of a set of points, or null when they cancel out. */
function meanDirection(points: readonly Vec3[]): Vec3 | null {
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) {
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return normalized(sum);
}

/**
 * One point per territory: the mean direction of its outline. Averaged as 3D
 * directions, not degrees, so a territory straddling the date line lands on it
 * rather than on the far side of the planet.
 */
function territoryCentroids(globe: ClipGlobeData): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const t of globe.territories) {
    const pts: Vec3[] = [];
    for (const ring of t.rings) for (const [lng, lat] of ring) pts.push(unitVector(lng, lat));
    const c = meanDirection(pts);
    if (c) out.set(t.territory_id, c);
  }
  return out;
}

/** Whether some territory sits beyond what the clip's fixed framing can show. */
function needsFollow(globe: ClipGlobeData, centroids: Map<string, Vec3>): boolean {
  // The live globe does not turn on these maps either; their clips stay put.
  if (globe.lockRotation) return false;
  const center = unitVector(globe.camera.centerLng, globe.camera.centerLat);
  for (const c of centroids.values()) {
    if (angleDeg(center, c) > FOLLOW_TRIGGER_DEG) return true;
  }
  return false;
}

/** Territories on the globe whose owner differs between two moments. */
function changedHands(prev: ClipFrameState, cur: ClipFrameState, centroids: Map<string, Vec3>): Vec3[] {
  const out: Vec3[] = [];
  for (const [id, c] of centroids) {
    const before = prev.territories[id]?.owner_id ?? null;
    const after = cur.territories[id]?.owner_id ?? null;
    if (before !== after) out.push(c);
  }
  return out;
}

/** The territories of whoever holds the most of the globe — the closing shot when the last moment changes nothing. */
function leaderTerritories(state: ClipFrameState, centroids: Map<string, Vec3>): Vec3[] {
  const held = new Map<string, Vec3[]>();
  for (const [id, c] of centroids) {
    const owner = state.territories[id]?.owner_id;
    if (!owner) continue;
    const list = held.get(owner);
    if (list) list.push(c);
    else held.set(owner, [c]);
  }
  let best: Vec3[] = [];
  for (const list of held.values()) if (list.length > best.length) best = list;
  return best;
}

function coveredBy(center: Vec3, points: readonly Vec3[]): Vec3[] {
  return points.filter((p) => angleDeg(center, p) <= COVER_DEG);
}

/**
 * Where to look to show `points`: the view that keeps the most of them well
 * inside the visible side, preferring the one nearest the camera on a tie, then
 * centered on what it covers. Two fronts on opposite sides of the planet get
 * the bigger one, not the empty ocean between them.
 */
function aimAt(points: readonly Vec3[], current: Vec3): Vec3 | null {
  if (points.length === 0) return null;
  const candidates: Vec3[] = [current, ...points];
  const mean = meanDirection(points);
  if (mean) candidates.push(mean);

  let best = current;
  let bestCount = -1;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const count = coveredBy(c, points).length;
    const distance = angleDeg(c, current);
    if (count > bestCount || (count === bestCount && distance < bestDistance)) {
      best = c;
      bestCount = count;
      bestDistance = distance;
    }
  }

  const centered = meanDirection(coveredBy(best, points));
  // Centering must not push part of what the view covered back off it.
  if (centered && coveredBy(centered, points).length >= bestCount) return centered;
  return best;
}

function stepStarts(steps: readonly ClipCameraStep[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const s of steps) {
    starts.push(acc);
    acc += s.durationMs;
  }
  return starts;
}

/**
 * For each moment, the territories on this board that changed hands since the
 * moment before; the opening moment has nothing to compare with. The Moon inset
 * outlines them and grows while there are any.
 */
export function capturesByStep(
  globe: ClipGlobeData | null | undefined,
  steps: readonly ClipCameraStep[],
): string[][] {
  if (!globe) return steps.map(() => []);
  const ids = globe.territories.map((t) => t.territory_id);
  return steps.map((step, i) => {
    if (i === 0) return [];
    const prev = steps[i - 1].state.territories;
    const cur = step.state.territories;
    return ids.filter((id) => (prev[id]?.owner_id ?? null) !== (cur[id]?.owner_id ?? null));
  });
}

/**
 * Plan the camera for a clip, or null when the board needs no moving camera —
 * a flat board, a map that locks rotation, or one whose every territory the
 * fixed framing already shows. Null means "draw exactly as before".
 */
export function planClipCamera(
  globe: ClipGlobeData | null | undefined,
  steps: readonly ClipCameraStep[],
): ClipCameraPath | null {
  if (!globe || steps.length < 2) return null;
  const centroids = territoryCentroids(globe);
  if (!needsFollow(globe, centroids)) return null;

  const base = globe.camera;
  const starts = stepStarts(steps);
  const turns: ClipCameraTurn[] = [];
  let current = unitVector(base.centerLng, base.centerLat);
  // The opening view gets the same rest as any other.
  let lastTurnEnd = 0;

  for (let i = 1; i < steps.length; i++) {
    let action = changedHands(steps[i - 1].state, steps[i].state, centroids);
    if (action.length === 0 && i === steps.length - 1) action = leaderTerritories(steps[i].state, centroids);
    const target = aimAt(action, current);
    if (!target) continue;
    const turn = angleDeg(current, target);
    if (turn < MIN_TURN_DEG) continue;

    const wanted = TRAVEL_BASE_MS + (turn / 180) * TRAVEL_PER_180_MS;
    const arrive = starts[i];
    const lead = Math.max(0, Math.min(wanted, steps[i - 1].durationMs * LEAD_SHARE, arrive - (lastTurnEnd + REST_MS)));
    const lag = Math.min(Math.max(0, wanted - lead), steps[i].durationMs * LAG_SHARE);
    if (lead + lag <= 0) continue;

    turns.push({
      stepIndex: i,
      startMs: arrive - lead,
      arriveMs: arrive,
      endMs: arrive + lag,
      from: toCenter(current),
      to: toCenter(target),
    });
    current = target;
    lastTurnEnd = arrive + lag;
  }

  return { base, turns };
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** Wrap a longitude into [-180, 180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Between two views, by latitude and longitude separately — how the live
 * globe's own camera travels. North stays up the whole way, which a
 * great-circle path cannot promise near a pole, and the longitude goes the
 * short way round, across the date line when that is shorter.
 */
function between(a: GlobeCenter, b: GlobeCenter, u: number): GlobeCenter {
  let dLng = b.lng - a.lng;
  while (dLng > 180) dLng -= 360;
  while (dLng < -180) dLng += 360;
  return { lng: wrapLng(a.lng + dLng * u), lat: a.lat + (b.lat - a.lat) * u };
}

/** The camera at a point in the clip, and whether it is mid-turn (the renderer may draw coarser then). */
export function clipCameraAt(path: ClipCameraPath, ms: number): { camera: ClipGlobeCamera; moving: boolean } {
  let at: GlobeCenter = { lng: path.base.centerLng, lat: path.base.centerLat };
  for (const turn of path.turns) {
    if (ms >= turn.endMs) {
      at = turn.to;
      continue;
    }
    if (ms > turn.startMs) {
      const u = easeInOutCubic((ms - turn.startMs) / (turn.endMs - turn.startMs));
      const c = between(turn.from, turn.to, u);
      return { camera: { ...path.base, centerLng: c.lng, centerLat: c.lat }, moving: true };
    }
    break;
  }
  return { camera: { ...path.base, centerLng: at.lng, centerLat: at.lat }, moving: false };
}

/**
 * Where the camera rests at a point in the clip, treating each turn as a cut
 * at the moment it arrives for. A GIF frame that holds through a turn it had
 * no in-between frames to spend on shows the view on the right side of that
 * cut rather than one frozen halfway round.
 */
export function clipCameraSettledAt(path: ClipCameraPath, ms: number): ClipGlobeCamera {
  let at: GlobeCenter = { lng: path.base.centerLng, lat: path.base.centerLat };
  for (const turn of path.turns) {
    if (ms < turn.arriveMs) break;
    at = turn.to;
  }
  return { ...path.base, centerLng: at.lng, centerLat: at.lat };
}

/** One GIF frame: which moment it shows, where on the timeline it is drawn, and how long it stays up. */
export interface ClipGifFrame {
  stepIndex: number;
  atMs: number;
  delayMs: number;
  /** An in-between frame of a camera turn rather than a held view. */
  turning: boolean;
}

/**
 * The GIF's frames. Without a camera plan that is one frame per moment, as
 * before. With one, each turn becomes a few in-between frames so the globe
 * visibly rotates rather than cutting. Every GIF frame is stored in full, so
 * the in-between frames share one budget for the whole clip; when turns
 * outnumber it the shortest of them simply cut.
 */
export function planClipGifFrames(
  steps: readonly ClipCameraStep[],
  path: ClipCameraPath | null,
): ClipGifFrame[] {
  const starts = stepStarts(steps);
  if (!path || path.turns.length === 0) {
    return steps.map((s, i) => ({ stepIndex: i, atMs: starts[i], delayMs: s.durationMs, turning: false }));
  }

  const wanted = path.turns.map((t) =>
    Math.min(
      GIF_MAX_TWEENS_PER_TURN,
      Math.max(GIF_MIN_TWEENS_PER_TURN, Math.round((t.endMs - t.startMs) / GIF_TWEEN_MS)),
    ),
  );
  const totalWanted = wanted.reduce((a, b) => a + b, 0);
  const scale = totalWanted > GIF_TWEEN_BUDGET ? GIF_TWEEN_BUDGET / totalWanted : 1;
  // Floored, so the budget holds exactly; a turn scaled down to nothing cuts.
  const remaining = wanted.map((w) => Math.floor(w * scale));
  const allotted = [...remaining];

  const frames: ClipGifFrame[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s0 = starts[i];
    const s1 = s0 + steps[i].durationMs;
    let t = s0;
    path.turns.forEach((turn, k) => {
      // The part of this turn that falls within this moment. A turn that sets
      // off early spans two moments, and its in-between frames are split
      // between them by time.
      const a = Math.max(turn.startMs, s0);
      const b = Math.min(turn.endMs, s1);
      if (b <= a) return;
      const n = b >= turn.endMs
        ? remaining[k]
        : Math.min(remaining[k], Math.round((allotted[k] * (b - a)) / (turn.endMs - turn.startMs)));
      if (n <= 0) return;
      remaining[k] -= n;
      if (a > t) frames.push({ stepIndex: i, atMs: t, delayMs: a - t, turning: false });
      const dt = (b - a) / n;
      // Each in-between frame shows the camera at the end of its slot, so the
      // first one has already moved and the last one has arrived.
      for (let j = 1; j <= n; j++) frames.push({ stepIndex: i, atMs: a + dt * j, delayMs: dt, turning: true });
      t = b;
    });
    if (s1 > t) frames.push({ stepIndex: i, atMs: t, delayMs: s1 - t, turning: false });
  }
  return frames;
}

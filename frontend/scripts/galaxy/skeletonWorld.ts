/**
 * Far worlds built from an authored landmass skeleton (`kind: 'skeleton'`).
 *
 *   1. LAND. The spec's shapes (caps, bands, capsules) are signed "degrees
 *      inside" fields; land is their union minus the cuts, evaluated on a
 *      domain-warped sphere and roughened with 3D value noise. Noise on the
 *      sphere itself, not on lng/lat, so there is no seam and no polar pinch.
 *   2. TERRITORIES. Every land cell goes to the seed with the shortest path
 *      THROUGH LAND (Dijkstra on the grid, with low-frequency cost noise so
 *      borders meander). A straight-line Voronoi lets a territory straddle a
 *      strait or a rift; this never can.
 *   3. BORDERS. Each territory's outline follows cell edges, so every
 *      coordinate is an exact multiple of the grid step. Outlines are cut at
 *      junctions into chains, and each chain is simplified and smoothed ONCE in
 *      a canonical direction, so two neighbours draw the identical border and
 *      the output does not depend on floating-point trig at all.
 *   4. CHECKS. The land borders the geometry produces must be exactly the
 *      spec's `landBorders`, every sea link must cross real water, every tile
 *      must clear a minimum area, and no tile may reach a pole or cross the
 *      antimeridian. A design is a graph first; if the coastline noise ever
 *      adds or removes a border, the build fails instead of shipping a
 *      different game.
 */
import { angleDeg, dot, sampleGreatCircle, toVec, type Vec3 } from './sphere';
import type { LngLat, SkeletonShape, SkeletonWorldSpec } from './worldSpecs';

/** Grid step in degrees. Every output coordinate is a multiple of RES / 32. */
export const RES = 0.5;
const W = Math.round(360 / RES);
const H = Math.round(180 / RES);
/** Shared cell edges below which two territories "touch" ambiguously (2°). */
const MIN_BORDER_EDGES = 4;
/** Narrowest water a sea link may cross: a strait has to read as one on the globe. */
const MIN_SEA_GAP = 2;
/** No territory cell may lie poleward of this latitude. */
const MAX_ABS_LAT = 80;
/** Douglas–Peucker tolerance (degrees) before smoothing. */
const SIMPLIFY_TOL = 0.6;
const SMOOTH_PASSES = 2;

export interface SkeletonTerritory {
  id: string;
  ring: LngLat[]; // closed
  center: LngLat;
  area_pct: number;
}

export interface SkeletonWorld {
  territories: SkeletonTerritory[];
  land: Array<[string, string]>;
  sea: Array<[string, string]>;
}

// ── 3D value noise ─────────────────────────────────────────────────────────────
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 0xffffff;
}

function vnoise3(p: Vec3, freq: number, seed: number): number {
  const qx = p[0] * freq, qy = p[1] * freq, qz = p[2] * freq;
  const ix = Math.floor(qx), iy = Math.floor(qy), iz = Math.floor(qz);
  const fx = qx - ix, fy = qy - iy, fz = qz - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let out = 0;
  for (let dx = 0; dx < 2; dx++) {
    const wx = dx ? ux : 1 - ux;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? uy : 1 - uy;
      for (let dz = 0; dz < 2; dz++) {
        const wz = dz ? uz : 1 - uz;
        out += wx * wy * wz * hash3(ix + dx, iy + dy, iz + dz, seed);
      }
    }
  }
  return out;
}

function fbm3(p: Vec3, base: number, octaves: number, seed: number): number {
  let s = 0, a = 1, n = 0, f = base;
  for (let o = 0; o < octaves; o++) {
    s += a * vnoise3(p, f, seed + 101 * o);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// ── Shapes: signed degrees inside ─────────────────────────────────────────────
type Field = (q: Vec3) => number;

function shapeField(shape: SkeletonShape): Field {
  switch (shape.kind) {
    case 'cap': {
      const c = toVec(shape.center[0], shape.center[1]);
      return (q) => shape.radius - angleDeg(q, c);
    }
    case 'band': {
      const c = toVec(shape.center[0], shape.center[1]);
      return (q) => shape.half - Math.abs(angleDeg(q, c) - shape.mid);
    }
    case 'capsule': {
      const samples = sampleGreatCircle(shape.points, 0.75);
      return (q) => {
        let best = -1;
        for (const s of samples) { const d = dot(q, s); if (d > best) best = d; }
        return shape.radius - Math.acos(Math.max(-1, Math.min(1, best))) * (180 / Math.PI);
      };
    }
    default: {
      const never: never = shape;
      throw new Error(`Unknown skeleton shape ${JSON.stringify(never)}`);
    }
  }
}

// ── Grid helpers ──────────────────────────────────────────────────────────────
const cellLng = (x: number) => -180 + (x + 0.5) * RES;
const cellLat = (y: number) => 90 - (y + 0.5) * RES;
const wrapX = (x: number) => (x + W) % W;

function cellOf([lng, lat]: LngLat): number {
  const x = wrapX(Math.floor((lng + 180) / RES));
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  return y * W + x;
}

/** 4-neighbours of a cell (x wraps; y does not). */
function neighbours4(i: number): number[] {
  const x = i % W, y = (i - x) / W;
  const out = [y * W + wrapX(x - 1), y * W + wrapX(x + 1)];
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
}

class MinHeap {
  private d: number[] = [];
  private n: number[] = [];
  get size(): number { return this.d.length; }
  private less(i: number, j: number): boolean {
    return this.d[i] < this.d[j] || (this.d[i] === this.d[j] && this.n[i] < this.n[j]);
  }
  private swap(i: number, j: number): void {
    [this.d[i], this.d[j]] = [this.d[j], this.d[i]];
    [this.n[i], this.n[j]] = [this.n[j], this.n[i]];
  }
  push(dist: number, node: number): void {
    this.d.push(dist); this.n.push(node);
    let i = this.d.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.d[0], this.n[0]];
    const ld = this.d.pop()!, ln = this.n.pop()!;
    if (this.d.length) {
      this.d[0] = ld; this.n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.d.length && this.less(l, m)) m = l;
        if (r < this.d.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

// ── 1. Land ───────────────────────────────────────────────────────────────────
function buildLand(spec: SkeletonWorldSpec): { land: Uint8Array; cost: Float64Array } {
  const add = spec.land.add.map(shapeField);
  const cut = spec.land.cut.map(shapeField);
  const land = new Uint8Array(W * H);
  const cost = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = toVec(cellLng(x), cellLat(y));
      const d: Vec3 = [0, 1, 2].map((k) => fbm3(p, spec.warp.freq, 4, spec.seed + k * 7919) - 0.5) as Vec3;
      const q = [p[0] + spec.warp.amp * d[0], p[1] + spec.warp.amp * d[1], p[2] + spec.warp.amp * d[2]] as Vec3;
      const n = Math.hypot(q[0], q[1], q[2]);
      q[0] /= n; q[1] /= n; q[2] /= n;
      let f = -90;
      for (const s of add) f = Math.max(f, s(q));
      for (const s of cut) f = Math.min(f, -s(q));
      const rough = (fbm3(p, spec.noise.freq, 5, spec.seed + 17) - 0.5) * 2;
      const i = y * W + x;
      land[i] = f + spec.noise.amp * rough > 0 ? 1 : 0;
      const b = fbm3(p, spec.border.freq, 4, spec.seed + 77) - 0.5;
      cost[i] = 1 + spec.border.noise * b * b * 4;
    }
  }
  return { land, cost };
}

// ── 2. Partition by path through land ─────────────────────────────────────────
function partition(spec: SkeletonWorldSpec, land: Uint8Array, cost: Float64Array): Int16Array {
  const label = new Int16Array(W * H).fill(-1);
  const dist = new Float64Array(W * H).fill(Infinity);
  const heap = new MinHeap();
  spec.territories.forEach((t, k) => {
    const c = cellOf(t.at);
    if (!land[c]) throw new Error(`${spec.world_id}: seed of ${t.id} at [${t.at}] is not on land`);
    if (label[c] !== -1) throw new Error(`${spec.world_id}: ${t.id} shares a seed cell`);
    const head = Math.max(0, 1 / (t.weight ?? 1) - 1) * 12;
    dist[c] = head;
    label[c] = k;
    heap.push(head, c);
  });
  const coslat = (y: number) => Math.cos(cellLat(y) * (Math.PI / 180));
  const steps: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    const ux = u % W, uy = (u - ux) / W;
    for (const [dx, dy] of steps) {
      const vy = uy + dy;
      if (vy < 0 || vy >= H) continue;
      const v = vy * W + wrapX(ux + dx);
      if (!land[v]) continue;
      const ddx = RES * Math.abs(dx) * 0.5 * (coslat(uy) + coslat(vy));
      const ddy = RES * Math.abs(dy);
      const nd = d + Math.hypot(ddx, ddy) * 0.5 * (cost[u] + cost[v]);
      if (nd < dist[v]) { dist[v] = nd; label[v] = label[u]; heap.push(nd, v); }
    }
  }
  return label;
}

/** Connected components (4-neighbour, x wraps) of the cells where `inSet` holds. */
function components(inSet: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !inSet(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const n of neighbours4(c)) if (!seen[n] && inSet(n)) { seen[n] = 1; stack.push(n); }
    }
    out.push(comp);
  }
  return out;
}

/**
 * Make every territory one simple region: keep its largest piece, give fully
 * enclosed lakes to the territory around them, and remove diagonal-only
 * contacts (a "pinch" would make a self-touching outline).
 */
function tidy(spec: SkeletonWorldSpec, label: Int16Array): void {
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let k = 0; k < spec.territories.length; k++) {
      const comps = components((i) => label[i] === k).sort((a, b) => b.length - a.length || a[0] - b[0]);
      for (const c of comps.slice(1)) { for (const i of c) label[i] = -1; changed = true; }
    }
    for (const comp of components((i) => label[i] === -1)) {
      const around = new Set<number>();
      let touchesPoleRow = false;
      for (const c of comp) {
        const y = Math.floor(c / W);
        if (y === 0 || y === H - 1) touchesPoleRow = true;
        for (const n of neighbours4(c)) if (label[n] !== -1) around.add(label[n]);
      }
      if (around.size === 1 && !touchesPoleRow) {
        const k = [...around][0];
        for (const c of comp) label[c] = k;
        changed = true;
      }
    }
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W; x++) {
        const i00 = y * W + x, i01 = y * W + wrapX(x + 1), i10 = i00 + W, i11 = i01 + W;
        const a = label[i00], b = label[i01], c = label[i10], d = label[i11];
        if (a >= 0 && a === d && b !== a && c !== a) {
          label[b === -1 || c !== -1 ? i01 : i10] = a; changed = true;
        } else if (b >= 0 && b === c && a !== b && d !== b) {
          label[a === -1 || d !== -1 ? i00 : i11] = b; changed = true;
        }
      }
    }
    if (!changed) return;
  }
  throw new Error(`${spec.world_id}: territory cleanup did not settle`);
}

// ── 3. Outlines ───────────────────────────────────────────────────────────────
// Corner (i, j) sits at lng -180 + i·RES, lat 90 - j·RES; i ∈ [0, W], j ∈ [0, H].
type Corner = number; // j * (W + 1) + i
const corner = (i: number, j: number): Corner => j * (W + 1) + i;
const cornerI = (c: Corner) => c % (W + 1);
const cornerJ = (c: Corner) => (c - (c % (W + 1))) / (W + 1);

function cellLabel(label: Int16Array, x: number, y: number): number {
  if (y < 0 || y >= H) return -1;
  return label[y * W + wrapX(x)];
}

/** A corner where three or more labels meet: every border chain ends at one. */
function isJunction(label: Int16Array, c: Corner): boolean {
  const i = cornerI(c), j = cornerJ(c);
  return new Set([
    cellLabel(label, i - 1, j - 1), cellLabel(label, i, j - 1),
    cellLabel(label, i - 1, j), cellLabel(label, i, j),
  ]).size >= 3;
}

/** One closed outline of territory k, clockwise on screen (y down), as corners. */
function traceOutline(label: Int16Array, k: number, id: string): Corner[] {
  const next = new Map<Corner, Corner>();
  const add = (a: Corner, b: Corner) => {
    if (next.has(a)) throw new Error(`${id}: outline branches at corner ${a}`);
    next.set(a, b);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (label[y * W + x] !== k) continue;
      if (cellLabel(label, x, y - 1) !== k) add(corner(x, y), corner(x + 1, y));
      if (cellLabel(label, x + 1, y) !== k) add(corner(x + 1, y), corner(x + 1, y + 1));
      if (cellLabel(label, x, y + 1) !== k) add(corner(x + 1, y + 1), corner(x, y + 1));
      if (cellLabel(label, x - 1, y) !== k) add(corner(x, y + 1), corner(x, y));
    }
  }
  const start = Math.min(...next.keys());
  const loop: Corner[] = [];
  let c = start;
  do {
    loop.push(c);
    const n = next.get(c);
    if (n === undefined) throw new Error(`${id}: outline is not closed`);
    c = n;
  } while (c !== start && loop.length <= next.size);
  if (loop.length !== next.size) {
    throw new Error(`${id}: outline has ${next.size - loop.length} edges in a second loop (a hole or a detached piece)`);
  }
  return loop;
}

const cornerLngLat = (c: Corner): LngLat => [-180 + cornerI(c) * RES, 90 - cornerJ(c) * RES];

function perpDist(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
}

function simplify(pts: LngLat[], tol: number): LngLat[] {
  if (pts.length < 3) return pts;
  let best = -1, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > best) { best = d; at = i; }
  }
  if (best <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** Chaikin corner-cutting that keeps both ends fixed. */
function smoothOpen(pts: LngLat[]): LngLat[] {
  let cur = pts;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    if (cur.length < 3) return cur;
    const out: LngLat[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [a, b] = [cur[i], cur[i + 1]];
      if (i > 0) out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      if (i < cur.length - 2) out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/**
 * Simplify + smooth one border chain. The chain is processed in a canonical
 * direction (the lexicographically smaller of it and its reverse), so the
 * neighbour on the other side, which walks the same chain backwards, gets the
 * identical points.
 */
function shapeChain(chain: Corner[]): LngLat[] {
  const rev = [...chain].reverse();
  let flip = false;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] !== rev[i]) { flip = rev[i] < chain[i]; break; }
  }
  const canon = (flip ? rev : chain).map(cornerLngLat);
  const done = smoothOpen(simplify(canon, SIMPLIFY_TOL));
  return flip ? done.reverse() : done;
}

function shapeOutline(label: Int16Array, loop: Corner[]): LngLat[] {
  const cuts = loop.map((c, i) => (isJunction(label, c) ? i : -1)).filter((i) => i >= 0);
  if (cuts.length === 0) {
    // A coast with no neighbour at all: split at the first corner and halfway round.
    cuts.push(0, Math.floor(loop.length / 2));
  }
  const ring: LngLat[] = [];
  for (let n = 0; n < cuts.length; n++) {
    const from = cuts[n];
    const to = cuts[(n + 1) % cuts.length];
    const chain: Corner[] = [];
    for (let i = from; ; i = (i + 1) % loop.length) {
      chain.push(loop[i]);
      if (i === to && chain.length > 1) break;
    }
    ring.push(...shapeChain(chain).slice(0, -1));
  }
  // Corners run clockwise on screen, i.e. counter-clockwise in lng/lat. The
  // shipped rings are clockwise in lng/lat, so reverse and close.
  ring.reverse();
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** The territory cell deepest inside it (farthest from any other cell), for labels. */
function interiorPoint(label: Int16Array, k: number): LngLat {
  const depth = new Int32Array(W * H).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (label[i] !== k) continue;
    if (neighbours4(i).some((n) => label[n] !== k) || i < W || i >= W * (H - 1)) { depth[i] = 0; frontier.push(i); }
  }
  let best = frontier[0], d = 0;
  while (frontier.length) {
    const nextFrontier: number[] = [];
    d += 1;
    for (const c of frontier) {
      for (const n of neighbours4(c)) {
        if (label[n] === k && depth[n] === -1) { depth[n] = d; nextFrontier.push(n); }
      }
    }
    if (nextFrontier.length) best = Math.min(...nextFrontier);
    frontier = nextFrontier;
  }
  const x = best % W, y = (best - x) / W;
  return [cellLng(x), cellLat(y)];
}

// ── 4. Checks ─────────────────────────────────────────────────────────────────
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildSkeletonWorld(spec: SkeletonWorldSpec): SkeletonWorld {
  const ids = spec.territories.map((t) => t.id);
  const { land, cost } = buildLand(spec);
  const label = partition(spec, land, cost);
  tidy(spec, label);

  const errors: string[] = [];
  const cells: number[][] = ids.map(() => []);
  for (let i = 0; i < W * H; i++) if (label[i] >= 0) cells[label[i]].push(i);

  // Poles and the antimeridian.
  ids.forEach((id, k) => {
    if (cells[k].length === 0) { errors.push(`${id} has no land`); return; }
    const lats = cells[k].map((i) => Math.abs(cellLat(Math.floor(i / W))));
    if (Math.max(...lats) > MAX_ABS_LAT) errors.push(`${id} reaches ${Math.max(...lats).toFixed(1)}° latitude (limit ${MAX_ABS_LAT}°)`);
    if (cells[k].some((i) => i % W === 0 && label[i + W - 1] === k)) errors.push(`${id} crosses the antimeridian`);
  });

  // Land borders must be exactly the designed ones.
  const shared = new Map<string, number>();
  for (let i = 0; i < W * H; i++) {
    const a = label[i];
    if (a < 0) continue;
    const x = i % W;
    for (const n of [i - x + wrapX(x + 1), i + W]) {
      if (n >= W * H) continue;
      const b = label[n];
      if (b < 0 || b === a) continue;
      const key = pairKey(ids[a], ids[b]);
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const designed = new Set(spec.landBorders.map(([a, b]) => pairKey(a, b)));
  for (const [key, n] of shared) {
    if (n < MIN_BORDER_EDGES) errors.push(`${key.replace('|', ' and ')} touch along only ${n} cell edge(s) — make it a border or a strait`);
    else if (!designed.has(key)) errors.push(`${key.replace('|', '–')} share a land border the design does not have (${n} cell edges)`);
  }
  for (const key of designed) {
    if (!shared.has(key)) errors.push(`designed land border ${key.replace('|', '–')} is missing from the geometry`);
  }

  // Sea links must cross real water, and not too much of it.
  const coast = ids.map((_, k) => cells[k].filter((i) => neighbours4(i).some((n) => label[n] !== k))
    .map((i) => toVec(cellLng(i % W), cellLat(Math.floor(i / W)))));
  for (const [a, b] of spec.seaLinks) {
    const ka = ids.indexOf(a), kb = ids.indexOf(b);
    if (ka < 0 || kb < 0) { errors.push(`sea link ${a}–${b} names an unknown territory`); continue; }
    if (shared.has(pairKey(a, b))) { errors.push(`sea link ${a}–${b} already shares a land border`); continue; }
    let gap = Infinity;
    for (const p of coast[ka]) for (const q of coast[kb]) gap = Math.min(gap, angleDeg(p, q));
    if (gap > spec.maxSeaGap) errors.push(`sea link ${a}–${b} crosses ${gap.toFixed(1)}° of water (limit ${spec.maxSeaGap}°)`);
    if (gap < MIN_SEA_GAP) errors.push(`sea link ${a}–${b} crosses only ${gap.toFixed(1)}° of water (minimum ${MIN_SEA_GAP}°)`);
  }

  // Areas.
  let total = 0;
  const weight = (i: number) => Math.cos(cellLat(Math.floor(i / W)) * (Math.PI / 180));
  for (let i = 0; i < W * H; i++) total += weight(i);
  const area = cells.map((cs) => (cs.reduce((s, i) => s + weight(i), 0) / total) * 100);
  ids.forEach((id, k) => {
    if (area[k] < spec.minTileArea) errors.push(`${id} covers ${area[k].toFixed(2)}% of the sphere (minimum ${spec.minTileArea}%)`);
  });

  if (errors.length) throw new Error(`${spec.world_id} skeleton does not match its design:\n  - ${errors.join('\n  - ')}`);

  const territories = ids.map((id, k) => ({
    id,
    ring: shapeOutline(label, traceOutline(label, k, id)),
    center: interiorPoint(label, k),
    area_pct: Math.round(area[k] * 100) / 100,
  }));
  const sortPair = ([a, b]: [string, string]): [string, string] => (a < b ? [a, b] : [b, a]);
  const byPair = (p: [string, string], q: [string, string]) => (p[0] + '|' + p[1] < q[0] + '|' + q[1] ? -1 : 1);
  return {
    territories,
    land: spec.landBorders.map(sortPair).sort(byPair),
    sea: spec.seaLinks.map(sortPair).sort(byPair),
  };
}

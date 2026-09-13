import { idiv, imod } from './fixed';
import type { TerrainGrid } from './terrain';

/**
 * Flow field toward one target cell, built by Dijkstra over passable cells with
 * 8-neighbour moves (orthogonal 10, diagonal 14, no corner cutting past a blocked
 * orthogonal neighbour). Every unit heading for the same cell shares one field.
 *
 * The search is resumable: `ensure(cell)` runs only until that cell is settled, so a
 * field costs what its followers need and no more. Because the heap breaks ties by
 * cell index, the settled order — and therefore every `next` pointer — is a pure
 * function of (grid, target); a field extended later agrees with one built in one go.
 */

export const COST_ORTHOGONAL = 10;
export const COST_DIAGONAL = 14;

/** Heap keys pack (cost, index) into one integer; the index must fit in 21 bits. */
const INDEX_SPAN = 1 << 21;

export class FlowField {
  readonly target: number;
  /** Settled cost from each cell to the target, or -1 while unknown. */
  readonly cost: Int32Array;
  /** Next cell toward the target, or -1 (unknown, unreachable, or the target itself). */
  readonly next: Int32Array;
  private readonly settled: Uint8Array;
  private readonly heap: number[] = [];
  private readonly grid: TerrainGrid;
  private exhausted = false;

  constructor(grid: TerrainGrid, target: number) {
    if (!grid.isPassable(target)) throw new Error('warfront-sim: flow field target is not passable');
    this.grid = grid;
    this.target = target;
    this.cost = new Int32Array(grid.size).fill(-1);
    this.next = new Int32Array(grid.size).fill(-1);
    this.settled = new Uint8Array(grid.size);
    this.cost[target] = 0;
    this.push(0, target);
  }

  /** True once `cell` has a final cost (reachable) or the search has proven it unreachable. */
  isResolved(cell: number): boolean {
    return this.settled[cell] === 1 || this.exhausted;
  }

  /** Runs the search until `cell` is settled or nothing is left to explore. */
  ensure(cell: number): void {
    if (this.settled[cell] === 1 || this.exhausted) return;
    const grid = this.grid;
    const w = grid.width;
    const h = grid.height;
    while (this.heap.length > 0) {
      const key = this.pop();
      const idx = imod(key, INDEX_SPAN);
      if (this.settled[idx] === 1) continue; // stale heap entry
      const c = idiv(key, INDEX_SPAN);
      this.settled[idx] = 1;
      // Relax the neighbours BEFORE honouring an early exit: a settled cell is never
      // popped again, so returning first would leave its neighbours unreached forever.
      const col = idx - idiv(idx, w) * w;
      const row = idiv(idx, w);
      const left = col > 0 && grid.isPassable(idx - 1);
      const right = col < w - 1 && grid.isPassable(idx + 1);
      const up = row > 0 && grid.isPassable(idx - w);
      const down = row < h - 1 && grid.isPassable(idx + w);
      if (left) this.relax(idx - 1, c + COST_ORTHOGONAL, idx);
      if (right) this.relax(idx + 1, c + COST_ORTHOGONAL, idx);
      if (up) this.relax(idx - w, c + COST_ORTHOGONAL, idx);
      if (down) this.relax(idx + w, c + COST_ORTHOGONAL, idx);
      if (up && left && grid.isPassable(idx - w - 1)) this.relax(idx - w - 1, c + COST_DIAGONAL, idx);
      if (up && right && grid.isPassable(idx - w + 1)) this.relax(idx - w + 1, c + COST_DIAGONAL, idx);
      if (down && left && grid.isPassable(idx + w - 1)) this.relax(idx + w - 1, c + COST_DIAGONAL, idx);
      if (down && right && grid.isPassable(idx + w + 1)) this.relax(idx + w + 1, c + COST_DIAGONAL, idx);
      if (idx === cell) return;
    }
    this.exhausted = true;
  }

  private relax(idx: number, cost: number, from: number): void {
    if (this.settled[idx] === 1) return;
    const current = this.cost[idx];
    if (current !== -1 && current <= cost) return;
    this.cost[idx] = cost;
    this.next[idx] = from;
    this.push(cost, idx);
  }

  private push(cost: number, idx: number): void {
    const heap = this.heap;
    let i = heap.length;
    const key = cost * INDEX_SPAN + idx;
    heap.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent] <= key) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = key;
  }

  private pop(): number {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      let i = 0;
      const n = heap.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const child = r < n && heap[r] < heap[l] ? r : l;
        if (heap[child] >= last) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return top;
  }
}

/**
 * Small cache of fields keyed by target cell. Evicts the oldest entry past `capacity`;
 * a unit whose field was evicted simply rebuilds it — the result is identical.
 */
export class FlowFieldCache {
  private readonly fields = new Map<number, FlowField>();
  constructor(
    private readonly grid: TerrainGrid,
    private readonly capacity: number = 8,
  ) {}

  get(target: number): FlowField {
    const existing = this.fields.get(target);
    if (existing) return existing;
    const field = new FlowField(this.grid, target);
    this.fields.set(target, field);
    if (this.fields.size > this.capacity) {
      const oldest = this.fields.keys().next().value as number;
      this.fields.delete(oldest);
    }
    return field;
  }

  get size(): number {
    return this.fields.size;
  }
}

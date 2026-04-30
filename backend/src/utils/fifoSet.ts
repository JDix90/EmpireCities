/**
 * Bounded FIFO set: O(1) `has`/`add`, O(1) eviction of the oldest entry when
 * `size` exceeds `cap`. Used for action-id deduplication where we want to keep
 * a fixed-size rolling window of recently-seen IDs without ever wholesale
 * dropping the entire set (which would briefly disable replay protection).
 */
export class FifoSet<T> {
  private items: T[] = [];
  private set: Set<T> = new Set();

  constructor(private readonly cap: number) {
    if (cap <= 0) throw new Error('FifoSet cap must be > 0');
  }

  has(value: T): boolean {
    return this.set.has(value);
  }

  /**
   * Add a value. If already present, it's a no-op (existing position retained,
   * NOT moved to the back — this is FIFO, not LRU). Returns `true` if newly
   * inserted, `false` if it was a duplicate.
   */
  add(value: T): boolean {
    if (this.set.has(value)) return false;
    this.set.add(value);
    this.items.push(value);
    if (this.items.length > this.cap) {
      const evicted = this.items.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
    return true;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.set.clear();
  }
}

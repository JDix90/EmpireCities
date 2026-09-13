import { BUILDING_SPECS, type BuildingKindValue } from './rules';
import type { StateHasher } from './hash';

/**
 * Buildings. One per cell, owned by a seat, and the thing villagers are assigned TO
 * rather than clicked at (rule II).
 *
 * A building under construction exists from the moment the timber is paid: it occupies
 * its cell, it can be worked on, and it produces nothing until `complete`. That means a
 * half-built farm is a real, visible commitment — which is what makes placing it a
 * decision rather than a formality.
 */

export interface Building {
  readonly id: number;
  kind: BuildingKindValue;
  owner: number;
  cell: number;
  hp: number;
  maxHp: number;
  /** Builder-ticks accumulated. Complete when it reaches the kind's `buildTicks`. */
  progress: number;
  complete: boolean;
  /** Assigned villagers, ascending id. Gatherers when complete, builders when not. */
  workers: number[];
  /** Training queue: unit kinds, in order. Only the seat uses it in step 3. */
  queue: number[];
  /** Ticks remaining on the unit at the head of the queue. */
  queueRemaining: number;
  /** Ticks until a tower may fire again. */
  cooldown: number;
}

export interface BuildingInit {
  kind: BuildingKindValue;
  owner: number;
  cell: number;
  /** Pre-built (a starting seat) rather than a construction site. */
  complete?: boolean;
}

export class BuildingStore {
  private readonly items: Building[] = [];
  private readonly byId = new Map<number, Building>();
  private readonly byCell = new Map<number, Building>();
  private nextId = 1;

  place(init: BuildingInit): Building {
    const spec = BUILDING_SPECS[init.kind];
    if (!spec) throw new Error(`warfront-sim: unknown building kind ${String(init.kind)}`);
    const complete = init.complete ?? false;
    const building: Building = {
      id: this.nextId++,
      kind: init.kind,
      owner: init.owner,
      cell: init.cell,
      // A construction site starts fragile and is finished by builders, so a raid that
      // reaches it before it is done destroys much less than a finished building.
      hp: complete ? spec.hp : 1,
      maxHp: spec.hp,
      progress: complete ? spec.buildTicks : 0,
      complete,
      workers: [],
      queue: [],
      queueRemaining: 0,
      cooldown: 0,
    };
    this.items.push(building);
    this.byId.set(building.id, building);
    this.byCell.set(building.cell, building);
    return building;
  }

  get(id: number): Building | undefined {
    return this.byId.get(id);
  }

  atCell(cell: number): Building | undefined {
    return this.byCell.get(cell);
  }

  remove(id: number): boolean {
    const building = this.byId.get(id);
    if (!building) return false;
    this.byId.delete(id);
    if (this.byCell.get(building.cell) === building) this.byCell.delete(building.cell);
    const index = this.items.indexOf(building);
    if (index >= 0) this.items.splice(index, 1);
    return true;
  }

  get size(): number {
    return this.items.length;
  }

  /** Buildings in ascending id order. Do not mutate the array. */
  all(): readonly Building[] {
    return this.items;
  }

  /** Completed buildings of one owner, ascending id. */
  completedOf(owner: number): Building[] {
    return this.items.filter((b) => b.owner === owner && b.complete);
  }

  hashInto(h: StateHasher): void {
    h.int(this.nextId).int(this.items.length);
    for (const b of this.items) {
      h.int(b.id).int(b.kind).int(b.owner).int(b.cell).int(b.hp).int(b.maxHp).int(b.progress).bool(b.complete);
      h.int(b.workers.length);
      for (const w of b.workers) h.int(w);
      h.int(b.queue.length);
      for (const q of b.queue) h.int(q);
      h.int(b.queueRemaining).int(b.cooldown);
    }
  }
}

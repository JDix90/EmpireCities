import type { Fixed } from './fixed';
import type { StateHasher } from './hash';

/**
 * A mover. The only entity kind in step 1: it has a position, a speed and (optionally) a
 * goal it is walking toward. Every field is an integer; positions and speed are 16.16
 * fixed in CELL units (so x = 3 << 16 is the left edge of cell column 3).
 */
export interface Unit {
  readonly id: number;
  owner: number;
  x: Fixed;
  y: Fixed;
  /** Cells per tick, fixed. */
  speed: Fixed;
  /** Current move goal; meaningful only while `moving`. */
  goalX: Fixed;
  goalY: Fixed;
  moving: boolean;
  /**
   * Target cell of the flow field the unit follows, or -1 when it walks a straight
   * line (no terrain). Derived from the goal, so it is not hashed.
   */
  fieldKey: number;
}

export interface UnitInit {
  owner: number;
  x: Fixed;
  y: Fixed;
  speed: Fixed;
}

/**
 * Small entity store with a stable, deterministic iteration order (ascending id).
 * Ids are handed out monotonically and never reused within a match, so the array stays
 * sorted with no sorting step.
 */
export class EntityStore {
  private readonly units: Unit[] = [];
  private readonly byId = new Map<number, Unit>();
  private nextId = 1;

  spawn(init: UnitInit): Unit {
    const unit: Unit = {
      id: this.nextId++,
      owner: init.owner,
      x: init.x,
      y: init.y,
      speed: init.speed,
      goalX: init.x,
      goalY: init.y,
      moving: false,
      fieldKey: -1,
    };
    this.units.push(unit);
    this.byId.set(unit.id, unit);
    return unit;
  }

  get(id: number): Unit | undefined {
    return this.byId.get(id);
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  remove(id: number): boolean {
    const unit = this.byId.get(id);
    if (!unit) return false;
    this.byId.delete(id);
    const idx = this.units.indexOf(unit);
    if (idx >= 0) this.units.splice(idx, 1);
    return true;
  }

  get size(): number {
    return this.units.length;
  }

  /** Units in ascending id order. Do not mutate the array. */
  all(): readonly Unit[] {
    return this.units;
  }

  hashInto(h: StateHasher): void {
    h.int(this.nextId).int(this.units.length);
    for (const u of this.units) {
      h.int(u.id).int(u.owner).int(u.x).int(u.y).int(u.speed).int(u.goalX).int(u.goalY).bool(u.moving);
    }
  }
}

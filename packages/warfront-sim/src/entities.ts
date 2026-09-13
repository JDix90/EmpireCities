import type { Fixed } from './fixed';
import type { StateHasher } from './hash';
import { UNIT_SPECS, UnitKind, type UnitKindValue } from './rules';

/**
 * A unit: a position, a speed, optionally a goal it is walking toward, and from step 3
 * a kind, health and a job. Every field is an integer; positions and speed are 16.16
 * fixed in CELL units (so x = 3 << 16 is the left edge of cell column 3).
 */
export interface Unit {
  readonly id: number;
  owner: number;
  kind: UnitKindValue;
  hp: number;
  maxHp: number;
  /**
   * Building this unit is assigned to, or -1. Rule II: villagers are assigned, never
   * clicked — the job outlives any single move order, so it lives on the unit rather
   * than being inferred from where it happens to be standing.
   */
  job: number;
  /** Ticks until this unit may strike again. Combat is a cadence, not a stream. */
  cooldown: number;
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
  /** Defaults to a villager, which is what a scenario without a roster means. */
  kind?: UnitKindValue;
  hp?: number;
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
    const kind = init.kind ?? UnitKind.Villager;
    const maxHp = UNIT_SPECS[kind]?.hp ?? 1;
    const unit: Unit = {
      id: this.nextId++,
      owner: init.owner,
      kind,
      hp: init.hp ?? maxHp,
      maxHp,
      job: -1,
      cooldown: 0,
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

  /** Units of one owner, ascending id. */
  ownedBy(owner: number): Unit[] {
    return this.units.filter((u) => u.owner === owner);
  }

  hashInto(h: StateHasher): void {
    h.int(this.nextId).int(this.units.length);
    for (const u of this.units) {
      h.int(u.id).int(u.owner).int(u.kind).int(u.hp).int(u.maxHp).int(u.job).int(u.cooldown);
      h.int(u.x).int(u.y).int(u.speed).int(u.goalX).int(u.goalY).bool(u.moving);
    }
  }
}

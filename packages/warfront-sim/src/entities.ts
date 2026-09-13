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
  /**
   * Ticks this unit has spent exposed to attrition (rule VII), reset whenever it is safe.
   *
   * Per unit rather than per player, unlike starvation: a player's army is not all in one
   * place, and the half of it that is home should not be on the same clock as the half
   * besieging somebody. Reset on reaching safety rather than merely paused, so a soldier
   * that steps home for a moment starts its next bleed from a full interval — walking out
   * of enemy land has to be worth something.
   */
  attritionTimer: number;
  /**
   * Convoy this unit is aboard (rule V), or -1 when it is ashore.
   *
   * A unit at sea is still in this store, with its id, health and job intact — it simply
   * is not anywhere on the grid. Everything that reads positions has to skip it: combat,
   * attrition, movement and the tower that would otherwise shoot at a boat.
   */
  convoy: number;
  /**
   * Ticks left of an opposed landing, during which the unit takes double damage.
   *
   * "Landing on a beach you don't own: 20s at half armour." Armour is not a stat in this
   * roster, so half armour is double damage taken — the same statement in the vocabulary
   * the simulation actually has.
   */
  disembarkTimer: number;
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
      attritionTimer: 0,
      convoy: -1,
      disembarkTimer: 0,
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
      h.int(u.attritionTimer).int(u.convoy).int(u.disembarkTimer);
      h.int(u.x).int(u.y).int(u.speed).int(u.goalX).int(u.goalY).bool(u.moving);
    }
  }
}

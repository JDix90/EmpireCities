import type { StateHasher } from './hash';

/**
 * Rule V: the sea is a lane, and a convoy on it is out of reach.
 *
 * The brief's line is "a convoy at sea cannot be attacked — the fight is always on the
 * shore", and that is the whole reason a convoy is a RECORD rather than units walking
 * over water. A unit in transit keeps its id, its health and its orders, but it is not on
 * the grid: combat cannot see it, attrition cannot bleed it, nothing can shoot it, and
 * nothing it owns can shoot out. It reappears where it lands.
 *
 * Keeping the units in the entity store and flagging them, rather than deleting and
 * respawning them, is deliberate: an id that changed mid-match would break a player's
 * selection, and — worse — would break a replay, whose later commands name units by id.
 */

export interface Convoy {
  readonly id: number;
  owner: number;
  /** Port it sailed from, and the province that port stands in. */
  fromCell: number;
  fromProvince: number;
  /** Where it lands: a far port you own, or one of the province's beaches. */
  toCell: number;
  toProvince: number;
  departTick: number;
  arriveTick: number;
  /**
   * True when the landing is opposed — the far port is not ours, so the units come ashore
   * over a beach and spend the brief's twenty seconds at half armour.
   */
  overBeach: boolean;
  /** Unit ids aboard, ascending. */
  units: number[];
}

export class ConvoyStore {
  private readonly items: Convoy[] = [];
  private readonly byId = new Map<number, Convoy>();
  private nextId = 1;

  /**
   * Starts a crossing. Callers have already checked the port, the lane and the cap — this
   * is the bookkeeping, not the rule.
   */
  launch(init: Omit<Convoy, 'id'>): Convoy {
    const convoy: Convoy = { id: this.nextId++, ...init, units: [...init.units].sort((a, b) => a - b) };
    this.items.push(convoy);
    this.byId.set(convoy.id, convoy);
    return convoy;
  }

  get(id: number): Convoy | undefined {
    return this.byId.get(id);
  }

  /** Convoys in launch order, which is ascending id. Do not mutate the array. */
  all(): readonly Convoy[] {
    return this.items;
  }

  /**
   * The convoy still loading at this port for this landing on this tick, if any.
   *
   * Units embark one command at a time — the page issues one per selected unit, exactly
   * as it does for a move — so a squad boarding together arrives as several commands on
   * the SAME tick. Grouping them by (port, landing, tick) is what turns those back into
   * one convoy, which is what the cap applies to and what a watcher sees the size of.
   */
  loadingAt(owner: number, fromCell: number, toCell: number, tick: number): Convoy | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const c = this.items[i];
      if (c.departTick !== tick) break;
      if (c.owner === owner && c.fromCell === fromCell && c.toCell === toCell) return c;
    }
    return undefined;
  }

  land(id: number): void {
    const convoy = this.byId.get(id);
    if (!convoy) return;
    this.byId.delete(id);
    const at = this.items.indexOf(convoy);
    if (at >= 0) this.items.splice(at, 1);
  }

  hashInto(h: StateHasher): void {
    h.int(this.nextId).int(this.items.length);
    for (const c of this.items) {
      h.int(c.id).int(c.owner).int(c.fromCell).int(c.fromProvince).int(c.toCell).int(c.toProvince);
      h.int(c.departTick).int(c.arriveTick).bool(c.overBeach).int(c.units.length);
      for (const u of c.units) h.int(u);
    }
  }
}

/**
 * Lands every convoy whose crossing is up.
 *
 * `land` is injected because putting units back on the grid belongs to the simulation —
 * this module knows when a convoy arrives and nothing about what arriving means.
 */
export function stepConvoys(store: ConvoyStore, tick: number, land: (convoy: Convoy) => void): void {
  // A snapshot: landing removes the convoy from the store mid-loop.
  for (const convoy of [...store.all()]) {
    if (tick < convoy.arriveTick) continue;
    land(convoy);
    store.land(convoy.id);
  }
}

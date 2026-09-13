import type { StateHasher } from './hash';

/**
 * Province ownership — rule III, "the seat is the province".
 *
 * Ownership is not a second source of truth kept alongside the buildings: a province is
 * owned by whoever holds the seat standing in it, and `seat` is that building's id. When
 * the seat falls the province goes neutral and is up for grabs, which is what makes the
 * claim below the only way to take one.
 */

export interface Province {
  /** Index into the terrain asset's province list (1..N). */
  readonly index: number;
  /** Seat index of the owner, or 0 for neutral. */
  owner: number;
  /** Building id of the seat that holds it, or -1. */
  seat: number;
  /** Seat index currently claiming a seatless province, or 0. */
  claimant: number;
  /** Ticks of claim progress accumulated by `claimant`. */
  claimTicks: number;
  /**
   * True once a seat has ever stood here. Rule I buys a province nobody has settled;
   * rule III's 45-second claim is the ONLY way to take one whose seat you razed. Without
   * that split a besieger could pay to skip the claim, and the window the rule exists to
   * give the defender — long enough to counterattack, visible to everyone nearby —
   * would evaporate.
   */
  everSettled: boolean;
}

export class ProvinceStore {
  private readonly items: Province[] = [];
  private readonly byIndex = new Map<number, Province>();

  /** Every province starts neutral; starting seats claim theirs at construction. */
  constructor(indices: readonly number[]) {
    for (const index of [...indices].sort((a, b) => a - b)) {
      const province: Province = { index, owner: 0, seat: -1, claimant: 0, claimTicks: 0, everSettled: false };
      this.items.push(province);
      this.byIndex.set(index, province);
    }
  }

  get(index: number): Province | undefined {
    return this.byIndex.get(index);
  }

  /** Provinces in ascending index. Do not mutate the array. */
  all(): readonly Province[] {
    return this.items;
  }

  /** How many provinces a seat holds — the input to the rising colonisation price. */
  heldBy(owner: number): number {
    let held = 0;
    for (const p of this.items) if (p.owner === owner) held += 1;
    return held;
  }

  ownedBy(owner: number): Province[] {
    return this.items.filter((p) => p.owner === owner);
  }

  hashInto(h: StateHasher): void {
    h.int(this.items.length);
    for (const p of this.items) {
      h.int(p.index).int(p.owner).int(p.seat).int(p.claimant).int(p.claimTicks).bool(p.everSettled);
    }
  }
}

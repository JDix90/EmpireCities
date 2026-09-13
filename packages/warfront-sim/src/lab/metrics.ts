import { idiv } from '../fixed';
import { TICKS_PER_MINUTE, UNIT_SPECS, UnitKind } from '../rules';
import type { Sim } from '../sim';
import type { MatchResult } from '../scoring';

/**
 * What the lab measures, and why each number is here.
 *
 * Every row answers one of the design questions in the brief's own table. The point is to
 * MEASURE them, not to assert them: a lab that asserted its answers would only ever
 * confirm them, and a number that misses its target is a finding rather than a red build.
 * The invariants CI does enforce live in invariants.test.ts and are things that must be
 * true of any correct simulation, rather than of a well-balanced one.
 */

export interface MatchMetrics {
  seed: number;
  seats: number;
  /** Seat index → policy name. */
  policies: Record<number, string>;
  ticks: number;
  reason: MatchResult['reason'];
  winner: number;
  /** Seat index → finishing place. */
  places: Record<number, number>;
  /**
   * First tick at which two seats' units came within sight of each other — the brief's
   * "time to first contact", which it wants between four and eight minutes.
   */
  firstContactTick: number | null;
  /** Seat index → army population at 5, 10 and 15 minutes. */
  armyAt: Record<number, [number, number, number]>;
  /**
   * Leader-to-second villager ratio at minute 15, ×100 so it stays an integer. The brief
   * wants it under 200 through minute fifteen in Colonist mirrors — the test of whether
   * the rising colonisation price actually stops a snowball.
   */
  economyRatioAt15: number;
  /** Seat index → the tick it was eliminated, or null. */
  eliminatedAt: Record<number, number | null>;
  /**
   * Seat index → the first tick it held no villagers at all, or null.
   *
   * Separate from elimination, and the more useful of the two: a seat only counts as
   * eliminated when it holds no province AND has no villager, and a seat building is very
   * hard to destroy — tribal raiders are skirmishers and nothing but a ram reduces a seat
   * — so a seat whose whole economy has been wiped out still holds its capital and is
   * still "alive". Without this the lab would report a match in which nobody can do
   * anything as a quiet draw.
   */
  economyWipedAt: Record<number, number | null>;
  /** The largest villager drawdown each seat suffered — mostly to tribes. */
  villagersLost: Record<number, number>;
}

/** How close two units must be, in cells, to count as having found each other. */
export const CONTACT_CELLS = 12;

const SAMPLE_MINUTES = [5, 10, 15] as const;

/** Collects one match's metrics as it runs. `observe` is handed straight to `runMatch`. */
export class MetricsCollector {
  private readonly seats: number[];
  private firstContact: number | null = null;
  private readonly army = new Map<number, [number, number, number]>();
  private readonly eliminated = new Map<number, number | null>();
  private readonly peakVillagers = new Map<number, number>();
  private readonly lostVillagers = new Map<number, number>();
  private readonly wipedAt = new Map<number, number | null>();
  private ratio15 = 0;

  constructor(seats: number[]) {
    this.seats = [...seats].sort((a, b) => a - b);
    for (const seat of this.seats) {
      this.army.set(seat, [0, 0, 0]);
      this.eliminated.set(seat, null);
      this.peakVillagers.set(seat, 0);
      this.lostVillagers.set(seat, 0);
      this.wipedAt.set(seat, null);
    }
  }

  observe = (sim: Sim): void => {
    // Once a second answers every question being asked here, and keeps the lab's cost in
    // the simulation rather than in measuring it.
    if (sim.tick % 15 !== 0) return;

    if (this.firstContact === null) this.firstContact = this.contactAt(sim);

    const villagers = new Map<number, number>();
    const soldiers = new Map<number, number>();
    for (const unit of sim.entities.all()) {
      if (unit.owner === 0) continue;
      if (unit.kind === UnitKind.Villager) {
        villagers.set(unit.owner, (villagers.get(unit.owner) ?? 0) + 1);
      } else if (unit.kind !== UnitKind.Scout) {
        soldiers.set(unit.owner, (soldiers.get(unit.owner) ?? 0) + (UNIT_SPECS[unit.kind]?.pop ?? 1));
      }
    }

    const standings = sim.standings;
    for (const seat of this.seats) {
      const now = villagers.get(seat) ?? 0;
      const peak = this.peakVillagers.get(seat) ?? 0;
      if (now > peak) this.peakVillagers.set(seat, now);
      else if (now < peak) {
        // Peak-to-trough is a lower bound on losses and needs no death hook inside the
        // simulation — which is the point: the sim stays a pure function of its input.
        this.lostVillagers.set(seat, Math.max(this.lostVillagers.get(seat) ?? 0, peak - now));
      }
      if (this.eliminated.get(seat) === null && standings.find((s) => s.seat === seat)?.eliminated) {
        this.eliminated.set(seat, sim.tick);
      }
      // Only once it HAS had villagers, so the opening tick does not count as a wipeout.
      if (this.wipedAt.get(seat) === null && peak > 0 && now === 0) this.wipedAt.set(seat, sim.tick);
    }

    SAMPLE_MINUTES.forEach((minute, i) => {
      if (sim.tick !== minute * TICKS_PER_MINUTE) return;
      for (const seat of this.seats) this.army.get(seat)![i] = soldiers.get(seat) ?? 0;
      if (minute === 15) {
        const counts = this.seats.map((s) => villagers.get(s) ?? 0).sort((a, b) => b - a);
        // A second seat with nothing left reports as the largest ratio rather than as a
        // division by zero; two empty seats are level, which is a ratio of one.
        this.ratio15 = counts[1] > 0 ? idiv(counts[0] * 100, counts[1]) : counts[0] > 0 ? 10000 : 100;
      }
    });
  };

  /** The earliest tick two seats had units within CONTACT_CELLS of one another. */
  private contactAt(sim: Sim): number | null {
    const units = [...sim.entities.all()].filter((u) => u.owner !== 0);
    const limit = CONTACT_CELLS * 65536;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        if (units[i].owner === units[j].owner) continue;
        if (Math.abs(units[i].x - units[j].x) <= limit && Math.abs(units[i].y - units[j].y) <= limit) {
          return sim.tick;
        }
      }
    }
    return null;
  }

  finish(seed: number, result: MatchResult, ticks: number, policies: Record<number, string>): MatchMetrics {
    const places: Record<number, number> = {};
    for (const standing of result.standings) places[standing.seat] = standing.place;
    return {
      seed,
      seats: this.seats.length,
      policies,
      ticks,
      reason: result.reason,
      winner: result.winner,
      places,
      firstContactTick: this.firstContact,
      armyAt: Object.fromEntries(this.army),
      economyRatioAt15: this.ratio15,
      eliminatedAt: Object.fromEntries(this.eliminated),
      economyWipedAt: Object.fromEntries(this.wipedAt),
      villagersLost: Object.fromEntries(this.lostVillagers),
    };
  }
}

export interface Tally {
  played: number;
  won: number;
  winPercent: number;
}

export interface Summary {
  matches: number;
  /** Policy name → seats played and won. */
  byPolicy: Record<string, Tally>;
  /** Seat index → seats played and won: the seat-fairness number. */
  bySeat: Record<number, Tally>;
  /** Share of matches that reached the cap rather than ending on a majority, as a percent. */
  endedOnClockPercent: number;
  /** Median first contact in whole seconds, or null when no match produced one. */
  medianFirstContactSeconds: number | null;
  /** Median leader-to-second economy ratio at minute 15, ×100. */
  medianEconomyRatio: number;
  /** Earliest elimination seen, in whole seconds, or null. */
  earliestEliminationSeconds: number | null;
  /** Matches in which every seat lost its whole villager economy. */
  economicWipeouts: number;
  /** Earliest tick any seat's economy was wiped out, in whole seconds, or null. */
  earliestWipeoutSeconds: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[idiv(sorted.length, 2)];
}

/**
 * A whole-number percentage, rounded half up, in integer arithmetic.
 *
 * The package's determinism lint bans `/` everywhere, and the lab is no exception even
 * though these numbers only ever reach a report. That is deliberate: an exemption for
 * "it is only reporting" is exactly how a float finds its way back into something that
 * matters, and the rule's whole value is having no exceptions to argue about.
 */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? idiv(part * 200 + whole, whole * 2) : 0;
}

/** Rolls a batch of matches up into the numbers the design questions ask for. */
export function summarise(all: readonly MatchMetrics[]): Summary {
  const byPolicy: Record<string, Tally> = {};
  const bySeat: Record<number, Tally> = {};
  let onClock = 0;
  let totalWipeouts = 0;
  const contacts: number[] = [];
  const ratios: number[] = [];
  const eliminations: number[] = [];
  const wipeouts: number[] = [];

  for (const m of all) {
    if (m.reason === 'cap') onClock += 1;
    if (m.firstContactTick !== null) contacts.push(idiv(m.firstContactTick, 15));
    if (m.economyRatioAt15 > 0) ratios.push(m.economyRatioAt15);
    for (const [key, tick] of Object.entries(m.eliminatedAt)) {
      if (tick !== null) eliminations.push(idiv(tick, 15));
      const seat = Number(key);
      const policy = m.policies[seat] ?? 'none';
      byPolicy[policy] ??= { played: 0, won: 0, winPercent: 0 };
      bySeat[seat] ??= { played: 0, won: 0, winPercent: 0 };
      byPolicy[policy].played += 1;
      bySeat[seat].played += 1;
      if (m.winner === seat) {
        byPolicy[policy].won += 1;
        bySeat[seat].won += 1;
      }
    }
    const wiped = Object.values(m.economyWipedAt);
    for (const t of wiped) if (t !== null) wipeouts.push(idiv(t, 15));
    if (wiped.length > 0 && wiped.every((t) => t !== null)) totalWipeouts += 1;
  }

  for (const row of [...Object.values(byPolicy), ...Object.values(bySeat)]) {
    row.winPercent = percentOf(row.won, row.played);
  }

  return {
    matches: all.length,
    byPolicy,
    bySeat,
    endedOnClockPercent: percentOf(onClock, all.length),
    medianFirstContactSeconds: contacts.length > 0 ? median(contacts) : null,
    medianEconomyRatio: median(ratios),
    earliestEliminationSeconds: eliminations.length > 0 ? Math.min(...eliminations) : null,
    economicWipeouts: totalWipeouts,
    earliestWipeoutSeconds: wipeouts.length > 0 ? Math.min(...wipeouts) : null,
  };
}

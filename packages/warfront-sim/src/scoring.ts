import { assertInt, idiv } from './fixed';
import type { EntityStore } from './entities';
import type { PlayerStore } from './players';
import type { ProvinceStore } from './provinces';
import { TICKS_PER_MINUTE, UnitKind } from './rules';

/**
 * The match format: how a match is won, and when it stops.
 *
 * The brief is explicit that scoring is "the format, not a rule to learn" — nobody has to
 * study it to play. Majority of provinces wins outright; otherwise the cap arrives and
 * placement is by provinces held, ties broken by cumulative province-minutes. That last
 * tiebreak is why holding ground EARLY is worth something even if you lose it later,
 * which is the whole reason a losing player keeps playing.
 *
 * `provinceTicks` is simulation state — it decides the outcome, so it is hashed like
 * everything else. Everything here is integer.
 */

/** Decision 30: the cap is 20 minutes at two seats, 25 at four. */
export const MATCH_CAP_MINUTES_TWO = 20;
export const MATCH_CAP_MINUTES_FOUR = 25;

/**
 * Ticks a match runs before the cap ends it.
 *
 * Decision 30 fixes two points and says nothing about three seats, so the cap scales
 * linearly through both — a three-seat match lands at 22.5 minutes, which is where a
 * reader would expect it rather than at a number nobody has decided. Halves are exact in
 * ticks (22.5 minutes is 20250), so this stays integer arithmetic.
 */
export function matchCapTicks(seats: number): number {
  const s = Math.max(2, assertInt(seats, 'seats'));
  const halfMinutes = 2 * MATCH_CAP_MINUTES_TWO + (s - 2) * (MATCH_CAP_MINUTES_FOUR - MATCH_CAP_MINUTES_TWO);
  return idiv(TICKS_PER_MINUTE * halfMinutes, 2);
}

/** Provinces needed to win outright: more than half of every province on the map. */
export function majorityOf(provinceCount: number): number {
  return idiv(assertInt(provinceCount, 'province count'), 2) + 1;
}

export interface ScoringContext {
  players: PlayerStore;
  provinces: ProvinceStore;
}

/**
 * One scoring tick: every seat banks a tick for each province it holds.
 *
 * One pass over the provinces rather than a `heldBy` call per seat — the same answer,
 * without re-walking the list once per player every tick for the whole match.
 */
export function stepScoring(ctx: ScoringContext): void {
  const held = new Map<number, number>();
  for (const province of ctx.provinces.all()) {
    if (province.owner === 0) continue;
    held.set(province.owner, (held.get(province.owner) ?? 0) + 1);
  }
  for (const player of ctx.players.all()) {
    player.provinceTicks += held.get(player.index) ?? 0;
  }
}

export interface Standing {
  seat: number;
  provinces: number;
  /** Cumulative province-ticks — the tiebreak, in the unit it is accumulated in. */
  provinceTicks: number;
  /** Province-minutes, floored: the same number in the unit the brief states it in. */
  provinceMinutes: number;
  /**
   * True when this seat holds nothing AND has no villager left. A villager is the only
   * way back — it is what claims a seatless province and what plants a new one — so a
   * seat with one is down, not out. The brief's own line: elimination is slow by design.
   */
  eliminated: boolean;
  /** 1-based finishing position. */
  place: number;
}

export type MatchEnd = 'majority' | 'cap' | 'last-standing';

export interface MatchResult {
  over: boolean;
  /** Why it ended, or null while it is still running. */
  reason: MatchEnd | null;
  /** Winning seat, or 0 while the match is running or if the leader is tied. */
  winner: number;
  standings: Standing[];
}

export interface MatchState {
  tick: number;
  players: PlayerStore;
  provinces: ProvinceStore;
  entities: EntityStore;
}

/**
 * The standings as they stand, ordered: provinces held, then province-ticks, then seat
 * index. The last key is there so two seats that genuinely tie on both still order the
 * same way on every machine — a placement that depended on map iteration order would be
 * a divergence in the one number the match is played for.
 */
export function standings(state: MatchState): Standing[] {
  const held = new Map<number, number>();
  for (const province of state.provinces.all()) {
    if (province.owner === 0) continue;
    held.set(province.owner, (held.get(province.owner) ?? 0) + 1);
  }
  const villagers = new Set<number>();
  for (const unit of state.entities.all()) {
    if (unit.kind === UnitKind.Villager) villagers.add(unit.owner);
  }

  const rows: Standing[] = state.players.all().map((player) => {
    const provinces = held.get(player.index) ?? 0;
    return {
      seat: player.index,
      provinces,
      provinceTicks: player.provinceTicks,
      provinceMinutes: idiv(player.provinceTicks, TICKS_PER_MINUTE),
      eliminated: provinces === 0 && !villagers.has(player.index),
      place: 0,
    };
  });

  rows.sort((a, b) => b.provinces - a.provinces || b.provinceTicks - a.provinceTicks || a.seat - b.seat);
  rows.forEach((row, i) => {
    row.place = i + 1;
  });
  return rows;
}

/** Whether the match is over, why, and who won. Pure: it decides nothing, it reads. */
export function matchResult(state: MatchState): MatchResult {
  const rows = standings(state);
  const majority = majorityOf(state.provinces.all().length);
  const alive = rows.filter((r) => !r.eliminated);

  const leader = rows[0];
  if (leader && leader.provinces >= majority) {
    return { over: true, reason: 'majority', winner: leader.seat, standings: rows };
  }
  // One seat left standing ends it early, whatever the clock says. A solo match against
  // nobody would otherwise run the full cap with nothing left to decide.
  if (rows.length > 1 && alive.length === 1) {
    return { over: true, reason: 'last-standing', winner: alive[0].seat, standings: rows };
  }
  if (state.tick >= matchCapTicks(rows.length)) {
    // A tie on BOTH keys leaves no winner rather than handing it to the lower seat
    // index: the order is deterministic, but it is not a result.
    const tied = rows.length > 1 && rows[1].provinces === leader.provinces && rows[1].provinceTicks === leader.provinceTicks;
    return { over: true, reason: 'cap', winner: tied ? 0 : (leader?.seat ?? 0), standings: rows };
  }
  return { over: false, reason: null, winner: 0, standings: rows };
}

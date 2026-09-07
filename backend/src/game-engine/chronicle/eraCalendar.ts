import type { EraId } from '../../types';

/**
 * In-fiction dates for the Chronicle.
 *
 * A turn number is a fact about the engine; a year is a fact about the world,
 * and it is what turns a list of events into a history. "Turn 12: Blue took
 * Iberia" is a log line. "1244: Blue takes Iberia" is a chronicle.
 *
 * `start` matches the year already printed on each era's map name and in
 * `ERA_METADATA` on the client ("Ancient World (200 AD)"), so the Chronicle
 * agrees with what the lobby told the player they were playing. `perTurn` is
 * chosen so a full-length match (the 40–60 turn caps Quick Match and the Full
 * Game use) stays inside the era it belongs to: the tight historical windows
 * advance by a fraction of a year per turn, the broad ones by several.
 */
interface EraEpoch {
  /** Year the era opens on. Negative is BC. */
  start: number;
  /** Years elapsed per game turn. Fractional for eras with a short window. */
  perTurn: number;
  /** Upper bound, where the era is a closed historical window. */
  end?: number;
}

const ERA_EPOCHS: Partial<Record<EraId, EraEpoch>> = {
  ancient: { start: 200, perTurn: 8 },
  medieval: { start: 1200, perTurn: 6 },
  discovery: { start: 1600, perTurn: 4 },
  // Closed windows: the war is over in six years, so a turn is a season.
  acw: { start: 1861, perTurn: 0.1, end: 1865 },
  ww2: { start: 1939, perTurn: 0.15, end: 1945 },
  risorgimento: { start: 1859, perTurn: 0.3, end: 1871 },
  coldwar: { start: 1947, perTurn: 1.1, end: 1991 },
  modern: { start: 2025, perTurn: 0.5 },
  space_age: { start: 2100, perTurn: 2 },
  // The Galactic Age has no terrestrial calendar to borrow; it counts its own.
  galaxy_age: { start: 3200, perTurn: 5 },
};

/** Fallback when a map's era is unknown (community maps, `custom`). */
const UNDATED: EraEpoch = { start: 1, perTurn: 1 };

/**
 * The year a turn falls in, for the era the world has reached by then.
 *
 * `turn` is 1-based, so turn 1 sits exactly on the era's opening year rather
 * than one stride past it.
 */
export function yearForTurn(eraId: string | undefined, turn: number): number {
  const epoch = ERA_EPOCHS[eraId as EraId] ?? UNDATED;
  const elapsed = Math.max(0, turn - 1) * epoch.perTurn;
  const year = epoch.start + elapsed;
  return epoch.end != null ? Math.min(year, epoch.end) : year;
}

/** "312 BC", "1244", "2100" — the label a chronicle entry carries. */
export function formatYear(year: number): string {
  const whole = Math.floor(year);
  if (whole <= 0) return `${Math.abs(whole - 1)} BC`;
  return String(whole);
}

/** Convenience: the dated label for a turn in an era. */
export function chronicleDate(eraId: string | undefined, turn: number): string {
  return formatYear(yearForTurn(eraId, turn));
}

/** Whether this era has a real-world calendar behind it (drives copy elsewhere). */
export function eraHasCalendar(eraId: string | undefined): boolean {
  return Boolean(ERA_EPOCHS[eraId as EraId]);
}

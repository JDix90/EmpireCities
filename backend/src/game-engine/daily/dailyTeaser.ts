/**
 * Tomorrow's Daily Challenge, named ahead of time for the results screen's
 * Tomorrow panel (comeback_hook_enabled): "Tomorrow: The Ottoman Gates".
 *
 * The schedule is deterministic in the date, and a stored day the schedule
 * later disagrees with is rewritten until someone plays it
 * (dailyPuzzleService.reconcileScheduledRow), so storing tomorrow's challenge
 * early is what the 23:30 pre-warm does anyway, only sooner. Generation is
 * not free, so each process does it once an hour at most, and concurrent
 * requests share one run. A failure gives no teaser, never an error.
 */
import { query } from '../../db/postgres';
import { excludedUserSql } from '../../services/statsExclusion';
import { ensureDailyChallengeForDate } from './dailyPuzzleService';
import { tomorrowsDailyDate } from './dailyPrewarmService';

export interface DailyTeaser {
  date: string;
  title: string;
  era_id: string;
}

const TTL_MS = 60 * 60 * 1000;

let cached: { date: string; at: number; teaser: DailyTeaser | null } | null = null;
let inFlight: { date: string; promise: Promise<DailyTeaser | null> } | null = null;

/** Tomorrow's title and era, or null when it cannot be had. */
export async function tomorrowsDailyTeaser(now: Date = new Date()): Promise<DailyTeaser | null> {
  const date = tomorrowsDailyDate(now);
  if (cached && cached.date === date && now.getTime() - cached.at < TTL_MS) return cached.teaser;
  if (inFlight && inFlight.date === date) return inFlight.promise;
  const promise = (async () => {
    try {
      const row = await ensureDailyChallengeForDate(date);
      const title = typeof row.spec?.title === 'string' ? row.spec.title : '';
      return title ? { date, title, era_id: row.era_id } : null;
    } catch (err) {
      console.warn('[daily] tomorrow teaser unavailable for', date, err);
      return null;
    }
  })();
  inFlight = { date, promise };
  try {
    const teaser = await promise;
    cached = { date, at: now.getTime(), teaser };
    return teaser;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/** Players who finished the challenge of `date` (test accounts left out). */
export async function dailyPlayersOn(date: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT dce.user_id)::int AS n
     FROM daily_challenge_entries dce
     JOIN users u ON u.user_id = dce.user_id
     WHERE dce.challenge_date = $1::date AND NOT ${excludedUserSql('u')}`,
    [date],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Test hook: forget the cached teaser. */
export function resetDailyTeaserForTests(): void {
  cached = null;
  inFlight = null;
}

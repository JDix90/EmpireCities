/**
 * Tell IndexNow about each Daily archive page the moment it settles.
 *
 * A day's `/daily/YYYY-MM-DD` page becomes public the instant the UTC date
 * rolls past it (see isArchivableDate in modules/daily/dailyArchiveData.ts).
 * That is one new permanent, genuinely-unique URL every day — exactly the shape
 * IndexNow exists for, and the difference between Bing seeing it in minutes and
 * seeing it whenever it next re-crawls the sitemap.
 *
 * Follows the setInterval pattern of dailyPrewarmService.ts.
 *
 * Deliberately forgetful: the last-submitted date lives in memory, so a restart
 * can re-submit a day. That is the right trade — IndexNow is idempotent, a
 * duplicate ping costs nothing, and the alternative is a migration and a table
 * to track something this cheap.
 */
import { featureFlags } from '../config/featureFlags';
import { dailyChallengeDate } from '../game-engine/daily/dailyPuzzleService';
import { dailyArchiveUrl, getIndexNowConfig, submitUrls } from './indexNow';

/** Hourly is ample: the target moves once a day and a few hours' lag is fine. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let lastSubmittedDate: string | null = null;

/** The most recently settled day — yesterday, in the daily calendar's UTC terms. */
export function mostRecentlySettledDate(now: Date = new Date()): string {
  return dailyChallengeDate(new Date(now.getTime() - 86_400_000));
}

/** Exposed for tests; resets the in-memory de-dupe. */
export function resetIndexNowSweepState(): void {
  lastSubmittedDate = null;
}

/**
 * Submit the most recently settled day, unless it has already been submitted by
 * this process. Returns the date submitted, or null when it did nothing.
 */
export async function submitSettledDay(now: Date = new Date()): Promise<string | null> {
  if (!featureFlags.indexNowEnabled) return null;
  if (!getIndexNowConfig()) return null;

  const date = mostRecentlySettledDate(now);
  if (date === lastSubmittedDate) return null;

  const result = await submitUrls([dailyArchiveUrl(date)]);
  // Only remember it on an accepted submission, so a transient failure is
  // retried on the next tick rather than silently skipped for the day.
  if (result.status !== null && result.status < 400) {
    lastSubmittedDate = date;
    return date;
  }
  return null;
}

export function startIndexNowDailySweep(): void {
  if (sweepInterval) return;
  // Once at boot as well as on the interval: a restart shortly after midnight
  // would otherwise wait an hour to announce the day that just settled.
  void submitSettledDay().catch((err) => console.error('[indexnow] sweep failed:', err));
  sweepInterval = setInterval(() => {
    submitSettledDay().catch((err) => console.error('[indexnow] sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
  sweepInterval.unref();
}

export function stopIndexNowDailySweep(): void {
  if (!sweepInterval) return;
  clearInterval(sweepInterval);
  sweepInterval = null;
}

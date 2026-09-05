import { dailyChallengeDate, ensureDailyChallengeForDate } from './dailyPuzzleService';

/**
 * Build tomorrow's daily row before midnight.
 *
 * A day is sized and proven (puzzleSim.ts) the first time its date is
 * served. That is one to two seconds of engine time, and without this sweep
 * it would land on the first player to open the daily after UTC midnight.
 * From 23:30 UTC the sweep asks for tomorrow's row; the read path creates it
 * if it is missing and reconciles it if it exists, so repeated calls are a
 * lookup. Follows the setInterval pattern of gameCleanupService.ts.
 */
const PREWARM_INTERVAL_MS = 10 * 60 * 1000;
const PREWARM_FROM_UTC_MINUTES = 23 * 60 + 30;

let prewarmInterval: ReturnType<typeof setInterval> | null = null;

export function tomorrowsDailyDate(now: Date = new Date()): string {
  return dailyChallengeDate(new Date(now.getTime() + 86_400_000));
}

export function isPrewarmWindow(now: Date = new Date()): boolean {
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= PREWARM_FROM_UTC_MINUTES;
}

export async function prewarmTomorrowsDaily(now: Date = new Date()): Promise<void> {
  if (!isPrewarmWindow(now)) return;
  const tomorrow = tomorrowsDailyDate(now);
  const row = await ensureDailyChallengeForDate(tomorrow);
  console.log(`[daily] pre-warmed ${tomorrow}: "${row.spec.title}"`);
}

export function startDailyPrewarm(): void {
  if (prewarmInterval) return;
  prewarmInterval = setInterval(() => {
    prewarmTomorrowsDaily().catch((err) => console.error('[daily] pre-warm failed:', err));
  }, PREWARM_INTERVAL_MS);
  prewarmInterval.unref();
}

export function stopDailyPrewarm(): void {
  if (!prewarmInterval) return;
  clearInterval(prewarmInterval);
  prewarmInterval = null;
}

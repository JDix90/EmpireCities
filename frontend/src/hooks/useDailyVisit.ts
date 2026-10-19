import { useEffect } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { deviceClass } from '../utils/device';

/**
 * Daily visit beacon: `app_opened`, at most once a UTC day per player, when a
 * signed-in player (guest or account) opens the game or comes back to its tab.
 *
 * Without it a player who returned without starting a game recorded nothing,
 * so the D1/D7 returns and the active-player counts (backend
 * services/analyticsQueries.ts) never saw them. It is posted from here rather
 * than from the server's token refresh because a tab left open refreshes its
 * token, and reconnects its socket, with nobody looking at it: a return is the
 * page loading or becoming visible again. UTC days, because the return queries
 * count the database's days.
 */

/** `<user_id>:<UTC day>` of the last beacon this browser delivered. */
const STORAGE_KEY = 'cc-last-app-opened';

let inFlight: string | null = null;
/** The same mark in memory, for a browser that cannot store it. */
let lastSent: string | null = null;

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function storedMark(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Post today's beacon for `userId` unless it has already gone. Exported for tests. */
export function reportDailyVisit(userId: string, now: Date = new Date()): void {
  const mark = `${userId}:${utcDay(now)}`;
  if (inFlight === mark || lastSent === mark || storedMark() === mark) return;
  inFlight = mark;
  api
    .post('/analytics/ui-event', { event: 'app_opened', properties: { device: deviceClass() } })
    .then(() => {
      lastSent = mark;
      try {
        localStorage.setItem(STORAGE_KEY, mark);
      } catch {
        /* storage unavailable: the in-memory mark covers this page */
      }
    })
    // A failed post is tried again the next time the page becomes visible.
    .catch(() => {})
    .finally(() => {
      if (inFlight === mark) inFlight = null;
    });
}

/** Test seam: forget the in-memory marks. */
export function resetDailyVisitForTests(): void {
  inFlight = null;
  lastSent = null;
}

export function useDailyVisit(): void {
  const userId = useAuthStore((s) => s.user?.user_id ?? null);
  // After the boot refresh, so the post carries a token and is not a 401.
  const ready = useAuthStore((s) => s.bootstrapped && s.isAuthenticated && s.accessToken != null);

  useEffect(() => {
    if (!ready || !userId) return;
    reportDailyVisit(userId);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reportDailyVisit(userId);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ready, userId]);
}

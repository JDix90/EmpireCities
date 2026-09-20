import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { useAsyncTurnAlertsEnabled } from '../../store/featureFlagsStore';
import { connectSocket, getSocket } from '../../services/socket';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';

/** What the server sends on `lobby:your_turn` (notificationService.notifyTurnChange). */
export interface YourTurnPayload {
  game_id: string;
  era_id: string;
  turn_number: number;
  /** Server-authoritative deadline as ms since epoch, or null for an untimed seat. */
  deadline_at: number | null;
}

/**
 * "23h to play" — deliberately coarse. The game page owns the live countdown;
 * this only has to say whether the player has hours or minutes.
 */
export function timeLeftLabel(deadlineAt: number | null, now = Date.now()): string | null {
  if (deadlineAt == null) return null;
  const ms = deadlineAt - now;
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/**
 * App-wide "it's your turn" alerts for async games (flag
 * `async_turn_alerts_enabled`, on by default).
 *
 * Renders nothing. While an authenticated session is active it keeps the
 * shared socket singleton connected (the same way GlobalMatchNotifier does —
 * pages only add and remove their own listeners; logout owns the disconnect)
 * and handles `lobby:your_turn` from ANY page:
 *
 *  - a toast with a Play button. Never an auto-navigate: an async seat has
 *    hours on the clock, and the player may be mid-turn in another game or
 *    halfway through the codex. Match-found yanks because a real-time clock
 *    is already running; this offers the door instead;
 *  - an OS notification when the tab is hidden (tag `turn-<gameId>`, shared
 *    with the FCM service worker so a push delivery replaces it rather than
 *    stacking);
 *  - nothing at all when the player is already looking at that game — the
 *    board itself says it is their move.
 *
 * Guests are included. Matchmaking is registered-only so the match notifier
 * skips them, but a guest in an async game needs this alert exactly as much
 * as anyone — losing a seat to a deadline you were never told about is how a
 * trial ends. The flag is the kill switch for the extra socket per guest tab.
 *
 * Before this existed, the only in-app signal was a "Your turn!" badge on the
 * lobby that loaded once on mount and never refreshed. A player sitting on the
 * lobby, let alone any other page, was told nothing.
 */
export default function GlobalTurnNotifier() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = useAsyncTurnAlertsEnabled();
  const navigate = useNavigate();
  const location = useLocation();

  // Ref so the stable socket handler always sees the current route.
  const locationRef = useRef(location);
  locationRef.current = location;

  // One alert per (game, turn). A rejoin re-arms the deadline server-side and
  // re-emits; the server's 5-minute throttle covers push and email but the
  // socket channel is deliberately unthrottled, so dedupe here instead.
  const seen = useRef(new Set<string>());

  const surfaceTurn = useCallback(
    (p: YourTurnPayload) => {
      const key = `${p.game_id}:${p.turn_number}`;
      if (seen.current.has(key)) return;
      if (seen.current.size > 200) seen.current.clear();
      seen.current.add(key);

      if (locationRef.current.pathname === `/game/${p.game_id}`) return;

      const era = ERA_LABELS[p.era_id] ?? p.era_id;
      const left = timeLeftLabel(p.deadline_at);
      const body = `${era} — turn ${p.turn_number}${left ? `. ${left} to play.` : '.'}`;

      // OS-level notification when the tab isn't visible. Only fires if the
      // player already granted permission (the push opt-in does the asking);
      // the tag matches the FCM SW so a push delivery replaces this.
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const options: NotificationOptions = {
          body,
          icon: '/favicon.svg',
          tag: `turn-${p.game_id}`,
          data: { url: `/game/${p.game_id}` },
        };
        const show = (reg?: ServiceWorkerRegistration) => {
          if (reg) void reg.showNotification("It's your turn!", options);
          else new Notification("It's your turn!", options);
        };
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker
            .getRegistration('/firebase-messaging-sw.js')
            .then((reg) => show(reg ?? undefined))
            .catch(() => show());
        } else {
          show();
        }
      }

      toast(
        (t) => (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <span className="font-medium text-bf-text">It&apos;s your turn</span> — {body}
            </p>
            <button
              type="button"
              className="btn-primary text-sm py-1.5"
              onClick={() => {
                toast.dismiss(t.id);
                navigate(`/game/${p.game_id}`);
              }}
            >
              Play
            </button>
          </div>
        ),
        // A fixed id per game: a later turn in the same game replaces the
        // toast instead of stacking a second one underneath it.
        { duration: 30_000, id: `your-turn-${p.game_id}` },
      );
    },
    [navigate],
  );

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;
    connectSocket();
    const socket = getSocket();
    socket.on('lobby:your_turn', surfaceTurn);
    return () => {
      // Only detach our listener — never disconnect or removeAllListeners on
      // the shared singleton (GamePage/GlobalMatchNotifier listeners live on
      // it too; logout owns the actual disconnect).
      socket.off('lobby:your_turn', surfaceTurn);
    };
  }, [enabled, isAuthenticated, surfaceTurn]);

  return null;
}

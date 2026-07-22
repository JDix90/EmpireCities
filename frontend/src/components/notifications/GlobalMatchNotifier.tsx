import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { useMatchAlertsEnabled } from '../../store/featureFlagsStore';
import { connectSocket, getSocket } from '../../services/socket';
import { api } from '../../services/api';
import { clearRankedSearchMarker, getRankedSearchMarker } from '../../utils/rankedSearchMarker';

/**
 * App-wide ranked match-found alerts (flag `match_alerts_enabled`).
 *
 * Renders nothing. While an authenticated non-guest session is active it:
 *  - owns the app-level connection of the shared socket singleton (pages only
 *    add/remove their own listeners; only logout disconnects — authStore);
 *  - handles `matchmaking:found` from ANY page: toast + auto-navigate into the
 *    game (product decision), except when the player is already inside another
 *    live game — then a long action toast instead of yanking them mid-turn;
 *  - shows an OS notification when the tab is hidden (tag `match-<gameId>`,
 *    shared with the FCM service worker so the two never stack);
 *  - runs a missed-match catch-up on mount/refocus: if this browser started a
 *    search (cc-ranked-search marker) and the queue row is gone, look for the
 *    freshly created ranked game in /users/me/active-games and surface it.
 */
export default function GlobalMatchNotifier() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isGuest = useAuthStore((s) => s.user?.is_guest === true);
  const enabled = useMatchAlertsEnabled();
  const navigate = useNavigate();
  const location = useLocation();

  // Refs so the stable socket handler always sees current values.
  const locationRef = useRef(location);
  locationRef.current = location;
  const lastCatchUpAt = useRef(0);

  const surfaceMatch = useCallback(
    (gameId: string) => {
      clearRankedSearchMarker();

      // OS-level notification when the tab isn't visible. Permission was
      // already requested by push init; tag matches the FCM SW so a push
      // delivery replaces this rather than duplicating it.
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const show = (reg?: ServiceWorkerRegistration) => {
          const options: NotificationOptions = {
            body: 'Your ranked game has started.',
            icon: '/favicon.svg',
            tag: `match-${gameId}`,
            data: { url: `/game/${gameId}` },
          };
          if (reg) void reg.showNotification('Match found!', options);
          else new Notification('Match found!', options);
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

      // Already inside a different live game? Don't yank mid-turn — offer a
      // button. Everywhere else: auto-navigate (the game has started and, on
      // real-time buckets, the turn clock is running).
      const path = locationRef.current.pathname;
      const onAnotherGame = path.startsWith('/game/') && path !== `/game/${gameId}`;
      if (onAnotherGame) {
        toast(
          (t) => (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-medium text-bf-text">Match found</span> — your ranked game has started.
              </p>
              <button
                type="button"
                className="btn-primary text-sm py-1.5"
                onClick={() => {
                  toast.dismiss(t.id);
                  navigate(`/game/${gameId}`);
                }}
              >
                Go to game
              </button>
            </div>
          ),
          { duration: 30_000 },
        );
      } else {
        toast.success('Match found!');
        navigate(`/game/${gameId}`);
      }
    },
    [navigate],
  );

  // Live socket alerts.
  useEffect(() => {
    if (!enabled || !isAuthenticated || isGuest) return;
    connectSocket();
    const socket = getSocket();
    const handler = ({ game_id }: { game_id: string }) => surfaceMatch(game_id);
    socket.on('matchmaking:found', handler);
    return () => {
      // Only detach our listener — never disconnect or removeAllListeners on
      // the shared singleton (GamePage/SpectatorPage listeners live on it too;
      // logout owns the actual disconnect).
      socket.off('matchmaking:found', handler);
    };
  }, [enabled, isAuthenticated, isGuest, surfaceMatch]);

  // Missed-match catch-up: on activation and whenever the tab regains focus.
  useEffect(() => {
    if (!enabled || !isAuthenticated || isGuest) return;

    const checkMissedMatch = async () => {
      const marker = getRankedSearchMarker();
      if (!marker) return;
      const now = Date.now();
      if (now - lastCatchUpAt.current < 15_000) return; // debounce refocus bursts
      lastCatchUpAt.current = now;

      try {
        const status = await api.get<{ queued: boolean }>('/matchmaking/status');
        if (status.data.queued) return; // still searching — keep the marker

        // Queue row is gone: either a match formed while we weren't listening,
        // or the search was cancelled elsewhere. Look for a ranked game newer
        // than the marker (generous skew — client clock vs server timestamps).
        const SKEW_MS = 5 * 60 * 1000;
        const { data: games } = await api.get<
          Array<{ game_id: string; is_ranked: boolean; created_at: string; started_at: string | null }>
        >('/users/me/active-games');
        const candidate = games
          .filter((g) => g.is_ranked)
          .filter((g) => Date.parse(g.started_at ?? g.created_at) >= marker.queued_at - SKEW_MS)
          .sort((a, b) => Date.parse(b.started_at ?? b.created_at) - Date.parse(a.started_at ?? a.created_at))[0];

        // Either way the marker is resolved — surfaced, or the search ended
        // without us (cancelled in another tab / game already finished).
        clearRankedSearchMarker();
        if (candidate) surfaceMatch(candidate.game_id);
      } catch {
        // Transient API failure: keep the marker; the next focus retries.
        lastCatchUpAt.current = 0;
      }
    };

    void checkMissedMatch();
    const onVisible = () => {
      if (!document.hidden) void checkMissedMatch();
    };
    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled, isAuthenticated, isGuest, surfaceMatch]);

  return null;
}

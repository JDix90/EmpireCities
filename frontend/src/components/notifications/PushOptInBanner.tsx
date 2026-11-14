import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { enableWebPush, getWebPushStatus, needsHomeScreenInstall } from '../../services/pushNotifications';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';
import { trackFunnel, useTrackShown } from '../../utils/funnelEvents';
import { useHomeScreenInstallEnabled } from '../../store/featureFlagsStore';
import { isStandaloneDisplay } from '../../services/homeScreenInstall';
import { InstallButton } from '../install/InstallOffer';

/** "Not now" keeps the card away this long. */
export const PUSH_NUDGE_SNOOZE_MS = 30 * 24 * 3_600_000;

interface PushOptInBannerProps {
  /** The player has at least one async game — the only time a turn alert has a turn to announce. */
  hasAsyncGames: boolean;
}

/**
 * Lobby card offering browser notifications to players with an async game.
 *
 * A Settings toggle alone gets no takers: nobody visits Settings to enable a
 * thing they do not know exists. This card appears where the async game is
 * listed, and only when clicking it can lead somewhere — a build with
 * Firebase, and a permission that was never asked. Guests included: a browser
 * token needs no email, and a guest in an async game loses their seat to a
 * deadline they were never told about. On an iPhone browser tab, where web push exists only
 * inside a Home Screen app, it gives that advice instead of a button that
 * could not work. The click is the gesture browsers require before they will
 * show the permission prompt; that is why the asking lives here and not in a
 * login effect (see enableWebPush).
 */
export default function PushOptInBanner({ hasAsyncGames }: PushOptInBannerProps) {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState(() => getWebPushStatus());
  const [dismissed, setDismissed] = useState(() => {
    const at = getPushNudgeDismissedAt();
    return at !== null && Date.now() - at < PUSH_NUDGE_SNOOZE_MS;
  });
  const [busy, setBusy] = useState(false);
  const iosTab = status === 'unsupported' && needsHomeScreenInstall();
  // home_screen_install_enabled: a player who has just opened Borderfall from
  // their home screen is asked here whatever games they have. Installing was
  // the step notifications were waiting on, most of all on an iPhone, where
  // this is the first place the question can be put at all.
  const installGuide = useHomeScreenInstallEnabled();
  const installedApp = installGuide && isStandaloneDisplay();
  const relevant = hasAsyncGames || installedApp;
  // funnel_events_v2_enabled: the ask shown against dismissed (the browser's
  // own answer is push_optin_granted/refused).
  useTrackShown(
    { event: 'push_ask_shown', surface: 'lobby_banner' },
    relevant && !!user && !dismissed && (status === 'default' || iosTab),
    { ios_tab: String(iosTab), ...(installedApp ? { installed_app: 'true' } : {}) },
  );

  if (!relevant || !user || dismissed) return null;
  if (status !== 'default' && !iosTab) return null;

  const dismiss = () => {
    trackFunnel({ event: 'push_ask_dismissed', surface: 'lobby_banner' }, { ios_tab: String(iosTab) });
    markPushNudgeDismissed();
    setDismissed(true);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      // enableWebPush prompts synchronously inside this click — see its doc.
      const result = await enableWebPush();
      if (result === 'granted') {
        toast.success("You'll get a notification when it's your turn");
        setStatus('granted');
      } else if (result === 'denied') {
        toast.error('Notifications are blocked for this site in your browser settings');
        setStatus('denied');
      } else if (result === 'error') {
        toast.error("Couldn't turn on notifications — try again in a moment");
      } else {
        // Dismissed without a choice: leave the card, it can be asked again.
        setStatus(getWebPushStatus());
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Turn notifications"
      className="card mb-6 border-bf-gold/40 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-in"
    >
      <BellRing className="w-6 h-6 text-bf-gold shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-bf-text">
          {iosTab ? 'Get turn alerts on this iPhone' : installedApp && !hasAsyncGames ? 'Turn on notifications' : "Know when it's your turn"}
        </p>
        <p className="text-sm text-bf-muted">
          {iosTab
            ? 'Add Borderfall to your Home Screen (Share → Add to Home Screen), then turn notifications on from there.'
            : installedApp && !hasAsyncGames
              ? 'Borderfall is on your home screen. Let it tell you when it is your turn, and before a daily streak runs out.'
              : 'Get a notification on this device when an opponent moves — even with the tab closed.'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!iosTab && (
          <button type="button" className="btn-primary text-sm py-1.5" onClick={turnOn} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        )}
        {iosTab && <InstallButton surface="push_ask" label="Show me how" />}
        <button
          type="button"
          className="btn-secondary text-sm py-1.5 inline-flex items-center gap-1"
          onClick={dismiss}
          aria-label={iosTab ? 'Got it' : 'Not now'}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" /> {iosTab ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

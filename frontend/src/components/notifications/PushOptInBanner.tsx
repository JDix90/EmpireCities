import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { enableWebPush, getWebPushStatus, needsHomeScreenInstall } from '../../services/pushNotifications';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';

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
 * listed, and only when clicking it can lead somewhere — a registered account
 * (guests cannot register a device), a build with Firebase, and a permission
 * that was never asked. On an iPhone browser tab, where web push exists only
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

  if (!hasAsyncGames || !user || user.is_guest || dismissed) return null;
  const iosTab = status === 'unsupported' && needsHomeScreenInstall();
  if (status !== 'default' && !iosTab) return null;

  const dismiss = () => {
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
          {iosTab ? 'Get turn alerts on this iPhone' : "Know when it's your turn"}
        </p>
        <p className="text-sm text-bf-muted">
          {iosTab
            ? 'Add Borderfall to your Home Screen (Share → Add to Home Screen), then turn notifications on from there.'
            : 'Get a notification on this device when an opponent moves — even with the tab closed.'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!iosTab && (
          <button type="button" className="btn-primary text-sm py-1.5" onClick={turnOn} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        )}
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

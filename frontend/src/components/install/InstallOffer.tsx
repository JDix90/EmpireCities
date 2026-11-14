import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useHomeScreenInstallEnabled } from '../../store/featureFlagsStore';
import {
  isProactiveInstallPath,
  startInstall,
  useInstallPath,
  type InstallPath,
} from '../../services/homeScreenInstall';
import { getInstallOfferDismissedAt, markInstallOfferDismissed } from '../../utils/userPreferences';
import { trackFunnel, useTrackShown, type InstallOfferSurface } from '../../utils/funnelEvents';

/** "Not now" keeps the lobby card and the results offer away this long. */
export const INSTALL_OFFER_SNOOZE_MS = 30 * 24 * 3_600_000;

/** What the button says: "Install" where the browser does it, "Add to Home Screen" where the player does. */
export function installButtonLabel(path: InstallPath): string {
  return path === 'prompt' ? 'Install Borderfall' : 'Add to Home Screen';
}

/** Press an install button: the browser's dialog, or the guide. Says so when the browser has nothing to show. */
export async function pressInstall(surface: InstallOfferSurface): Promise<void> {
  const result = await startInstall(surface);
  if (result === 'accepted') toast.success('Borderfall is on your home screen');
  else if (result === 'unavailable') toast("Your browser isn't offering to install right now. Look for Install or Add to Home screen in its menu.");
}

/**
 * A plain install button for places that already say why (a notification
 * ask, a Settings row). Renders nothing when the flag is off or this browser
 * has no way to add the site.
 */
export function InstallButton({ surface, className, label }: {
  surface: InstallOfferSurface;
  className?: string;
  /** Overrides the default label, e.g. "Show me how" beside text that names the feature. */
  label?: string;
}) {
  const enabled = useHomeScreenInstallEnabled();
  const path = useInstallPath();
  const [busy, setBusy] = useState(false);
  if (!enabled || path === 'installed' || path === 'none') return null;
  const press = async () => {
    setBusy(true);
    try {
      await pressInstall(surface);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={clsx('btn-primary text-sm py-1.5 inline-flex items-center gap-1.5 whitespace-nowrap', className)}
      onClick={press}
      disabled={busy}
      data-testid={`install-button-${surface}`}
    >
      <Download className="w-4 h-4" aria-hidden="true" /> {label ?? installButtonLabel(path)}
    </button>
  );
}

/**
 * The offer itself, for the lobby and the results screen: why, one button,
 * and "Not now". Shown only where one tap or one clear gesture gets it done
 * (the browser's dialog, or Share on an iPhone), only with the flag on, and
 * not within 30 days of a "Not now" on either surface.
 */
export default function InstallOffer({ surface, className }: {
  surface: Extract<InstallOfferSurface, 'lobby' | 'results'>;
  className?: string;
}) {
  const enabled = useHomeScreenInstallEnabled();
  const path = useInstallPath();
  const [dismissed, setDismissed] = useState(() => {
    const at = getInstallOfferDismissedAt();
    return at !== null && Date.now() - at < INSTALL_OFFER_SNOOZE_MS;
  });
  const visible = enabled && !dismissed && isProactiveInstallPath(path);
  useTrackShown({ event: 'install_offer_shown', surface }, visible, { path });
  if (!visible) return null;

  const dismiss = () => {
    trackFunnel({ event: 'install_offer_dismissed', surface }, { path });
    markInstallOfferDismissed();
    setDismissed(true);
  };

  return (
    <div
      role="region"
      aria-label="Add Borderfall to your home screen"
      data-testid={`install-offer-${surface}`}
      className={clsx('card border-bf-gold/40 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-in', className)}
    >
      <Smartphone className="w-6 h-6 text-bf-gold shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-bf-text">
          {surface === 'results' ? 'Keep Borderfall one tap away' : 'Put Borderfall on your home screen'}
        </p>
        <p className="text-sm text-bf-muted">
          {path === 'ios_share'
            ? 'It opens full screen like an app, and it is the only way an iPhone lets us tell you when it is your turn.'
            : 'It opens full screen like an app, straight to your games. No app store, nothing to download.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <InstallButton surface={surface} />
        <button
          type="button"
          className="btn-secondary text-sm py-1.5 inline-flex items-center gap-1 whitespace-nowrap"
          onClick={dismiss}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" /> Not now
        </button>
      </div>
    </div>
  );
}

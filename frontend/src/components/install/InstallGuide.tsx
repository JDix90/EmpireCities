import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, MoreVertical, PlusSquare, Share } from 'lucide-react';
import clsx from 'clsx';
import Modal from '../ui/Modal';
import {
  closeInstallGuide,
  iosSharePlacement,
  readInstallEnvironment,
  useInstallStore,
  type IosSharePlacement,
} from '../../services/homeScreenInstall';

/**
 * How to add Borderfall to the home screen where no button of ours can do it
 * (home_screen_install_enabled): an iPhone or iPad, a link opened inside
 * another app, or a phone browser that made no install offer.
 *
 * Mounted once at the app root; any install button opens it through
 * startInstall (services/homeScreenInstall.ts). On an iPhone it shows the
 * icons the player is looking for, drawn as iOS draws them, and an arrow at
 * the edge of the screen where Share sits.
 */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="shrink-0 w-6 h-6 rounded-full bg-bf-gold/15 border border-bf-gold/40 text-bf-gold text-xs font-semibold flex items-center justify-center"
        aria-hidden="true"
      >
        {n}
      </span>
      <span className="min-w-0 text-sm text-bf-text leading-snug">{children}</span>
    </li>
  );
}

/** An inline picture of a control the player has to find, with its name beside it. */
function Glyph({ icon: Icon, label }: { icon: typeof Share; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle rounded-md border border-bf-border bg-bf-dark px-1.5 py-0.5 text-bf-text whitespace-nowrap">
      <Icon className="w-4 h-4 text-sky-400" aria-hidden="true" />
      <span className="font-medium">{label}</span>
    </span>
  );
}

/** Points at Share: the bottom bar in Safari on an iPhone, the top right elsewhere. */
function ShareArrow({ placement }: { placement: IosSharePlacement }) {
  const Arrow = placement === 'bottom' ? ArrowDown : ArrowUp;
  return (
    <div
      data-testid="install-guide-arrow"
      data-placement={placement}
      aria-hidden="true"
      className={clsx(
        'fixed z-[60] pointer-events-none flex flex-col items-center gap-1 text-bf-gold',
        placement === 'bottom'
          ? 'left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+0.25rem)]'
          : 'right-3 top-[calc(env(safe-area-inset-top)+0.25rem)] flex-col-reverse',
      )}
    >
      <span className="rounded-full bg-bf-surface/95 border border-bf-gold/50 px-2 py-0.5 text-xs font-medium shadow-lg">
        Share is here
      </span>
      <Arrow className="w-7 h-7 motion-safe:animate-bounce drop-shadow" />
    </div>
  );
}

function IosShareSteps({ placement }: { placement: IosSharePlacement }) {
  return (
    <>
      <p className="text-sm text-bf-muted mb-4">
        Apple only lets you do this yourself. It takes three taps, and Borderfall then opens like any other app.
      </p>
      <ol className="space-y-3">
        <Step n={1}>
          Tap <Glyph icon={Share} label="Share" />{' '}
          {placement === 'bottom' ? 'in the bar at the bottom of the screen.' : 'at the top right of the screen.'}{' '}
          <span className="text-bf-muted">
            If you cannot see it, tap <MoreHorizontal className="inline w-4 h-4 align-middle" aria-label="the More button" /> first.
          </span>
        </Step>
        <Step n={2}>
          Scroll down the list and tap <Glyph icon={PlusSquare} label="Add to Home Screen" />.
        </Step>
        <Step n={3}>
          Tap <span className="font-medium text-sky-400">Add</span>. Then open Borderfall from your Home Screen and turn on
          notifications when it asks.
        </Step>
      </ol>
    </>
  );
}

function OpenInBrowserSteps() {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined' ? window.location.origin : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard here: the link below is selectable.
      setCopied(false);
    }
  };
  return (
    <>
      <p className="text-sm text-bf-muted mb-4">
        You opened Borderfall inside another app, and that app&apos;s browser cannot add sites to your Home Screen.
        Open it in Safari first.
      </p>
      <ol className="space-y-3">
        <Step n={1}>
          Tap <Glyph icon={MoreHorizontal} label="More" /> and choose <span className="font-medium">Open in Safari</span>{' '}
          (some apps call it Open in browser).
        </Step>
        <Step n={2}>
          Or copy the link and paste it into Safari:
          <span className="mt-2 flex items-center gap-2">
            <span className="min-w-0 truncate select-all rounded-md border border-bf-border bg-bf-dark px-2 py-1 text-xs text-bf-text" data-testid="install-guide-link">
              {link}
            </span>
            <button type="button" className="btn-secondary text-xs py-1 inline-flex items-center gap-1 shrink-0" onClick={copy}>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy link'}
            </button>
          </span>
        </Step>
        <Step n={3}>In Safari, come back to this button and it will show you the rest.</Step>
      </ol>
    </>
  );
}

function BrowserMenuSteps() {
  return (
    <>
      <p className="text-sm text-bf-muted mb-4">
        This browser keeps it in its own menu. Borderfall then opens like any other app.
      </p>
      <ol className="space-y-3">
        <Step n={1}>
          Open the browser menu: <Glyph icon={MoreVertical} label="Menu" />, usually at the top right.
        </Step>
        <Step n={2}>
          Tap <span className="font-medium">Add to Home screen</span> or <span className="font-medium">Install app</span>.
        </Step>
        <Step n={3}>Confirm, then open Borderfall from your home screen.</Step>
      </ol>
    </>
  );
}

export default function InstallGuideHost() {
  const guide = useInstallStore((s) => s.guide);
  if (!guide) return null;
  const placement = guide.path === 'ios_share' ? iosSharePlacement(readInstallEnvironment(false)) : null;
  return (
    <>
      <Modal
        open
        onClose={closeInstallGuide}
        title={guide.path === 'ios_in_app' ? 'Open Borderfall in Safari' : 'Add Borderfall to your Home Screen'}
        className="max-w-md"
      >
        <div data-testid="install-guide" data-path={guide.path}>
          {guide.path === 'ios_share' && placement && <IosShareSteps placement={placement} />}
          {guide.path === 'ios_in_app' && <OpenInBrowserSteps />}
          {guide.path === 'manual' && <BrowserMenuSteps />}
          <div className="mt-5 flex justify-end">
            <button type="button" className="btn-secondary text-sm" onClick={closeInstallGuide}>
              Done
            </button>
          </div>
        </div>
      </Modal>
      {placement && <ShareArrow placement={placement} />}
    </>
  );
}

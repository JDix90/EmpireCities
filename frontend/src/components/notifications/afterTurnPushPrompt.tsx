import { useState } from 'react';
import { BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { enableWebPush, getWebPushStatus, needsHomeScreenInstall } from '../../services/pushNotifications';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';
import { PUSH_NUDGE_SNOOZE_MS } from './PushOptInBanner';

export const AFTER_TURN_PROMPT_TOAST_ID = 'push-after-turn';

let offeredThisPageLoad = false;

/** "24 hours" / "2 days" / "1 hour" from the seat's deadline, for the copy. */
export function deadlineLabel(seconds: number | undefined): string {
  const hours = Math.max(1, Math.round((seconds ?? 86_400) / 3600));
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export interface AsyncTurnContext {
  settings: { async_mode?: boolean; async_turn_deadline_seconds?: number };
  phase: string;
}

/**
 * Offer browser notifications right after the player ends a turn in an async
 * game — the moment the wait becomes real to them. A card in the lobby is
 * easy to dismiss; "your opponent has 24 hours" is not.
 *
 * Returns true when a prompt was shown. At most once per page load, and never
 * when: the game is not async or has just ended; a click could not lead
 * anywhere (build without Firebase, permission already granted or refused,
 * a browser without push); or the player said "Not now" here or on the lobby
 * card within 30 days — one snooze for both. A toast that merely times out
 * is not a "no": the next session may ask again. On an iPhone browser tab
 * the advice is Add to Home Screen, since web push exists only inside one.
 * Guests included: a browser token needs no email, and a guest in an async
 * game is exactly who a turn alert is for.
 *
 * The buttons live inside the toast, so the click that calls enableWebPush
 * is a real user gesture — the one thing browsers require before they will
 * show the permission prompt.
 */
export function offerPushAfterAsyncTurn(game: AsyncTurnContext): boolean {
  if (offeredThisPageLoad) return false;
  if (!game.settings.async_mode || game.phase === 'game_over') return false;
  const status = getWebPushStatus();
  const iosTab = status === 'unsupported' && needsHomeScreenInstall();
  if (status !== 'default' && !iosTab) return false;
  const dismissedAt = getPushNudgeDismissedAt();
  if (dismissedAt !== null && Date.now() - dismissedAt < PUSH_NUDGE_SNOOZE_MS) return false;

  offeredThisPageLoad = true;
  const wait = deadlineLabel(game.settings.async_turn_deadline_seconds);
  toast((t) => <AfterTurnPrompt toastId={t.id} iosTab={iosTab} wait={wait} />, {
    duration: 45_000,
    id: AFTER_TURN_PROMPT_TOAST_ID,
  });
  return true;
}

/** Test hook: clears the once-per-page-load latch. */
export function resetAfterTurnPromptForTests(): void {
  offeredThisPageLoad = false;
}

function AfterTurnPrompt({ toastId, iosTab, wait }: { toastId: string; iosTab: boolean; wait: string }) {
  const [busy, setBusy] = useState(false);

  const dismiss = () => {
    markPushNudgeDismissed();
    toast.dismiss(toastId);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      // enableWebPush prompts synchronously inside this click — see its doc.
      const result = await enableWebPush();
      toast.dismiss(toastId);
      if (result === 'granted') {
        toast.success("You'll get a ping when it's your move");
      } else if (result === 'denied') {
        toast.error('Notifications are blocked for this site in your browser settings');
      } else if (result === 'error') {
        toast.error("Couldn't turn on notifications — try again from Settings");
      }
      // 'default': the browser prompt was dismissed without a choice. Say
      // nothing; the lobby card can ask again.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm" role="region" aria-label="Turn notifications">
      <p className="flex items-start gap-2">
        <BellRing className="w-4 h-4 text-bf-gold shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          <span className="font-medium text-bf-text">
            {iosTab ? 'Get turn alerts on this iPhone.' : "Get a ping when it's your move?"}
          </span>{' '}
          {iosTab
            ? 'Add Borderfall to your Home Screen (Share → Add to Home Screen), then turn notifications on from there.'
            : `Your opponent has up to ${wait} to play. This device gets a notification when the turn comes back to you, even with the tab closed.`}
        </span>
      </p>
      <div className="flex items-center gap-2">
        {!iosTab && (
          <button type="button" className="btn-primary text-sm py-1.5" onClick={turnOn} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        )}
        <button type="button" className="btn-secondary text-sm py-1.5" onClick={dismiss}>
          {iosTab ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

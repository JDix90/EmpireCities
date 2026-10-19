import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Coins, Swords, Snowflake, BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { enableWebPush, getWebPushStatus, needsHomeScreenInstall } from '../../services/pushNotifications';
import { guestLine } from '../../utils/guestGate';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';
import { PUSH_NUDGE_SNOOZE_MS } from '../notifications/PushOptInBanner';
import { useGuestPromptV2Enabled, useGuestPushRemindersEnabled } from '../../store/featureFlagsStore';
import { useSaveAccountCopyEnabled } from '../../store/featureFlagsStore';

interface ComebackData {
  is_guest: boolean;
  daily_streak: number;
  played_today: boolean;
  next_streak_milestone: { day: number; gold: number } | null;
  tomorrow_login_reward: number | null;
  already_claimed_today: boolean | null;
  daily_challenge_done_today: boolean;
  streak_freezes: number | null;
}

/**
 * The "come back tomorrow" moment on the game-over screen — the one place we
 * reliably have the player's attention at the end of a session. Shows the
 * streak they now have to protect, tomorrow's (bigger) login chest, and a
 * daily-challenge tease. Self-contained and fail-silent: if the fetch dies,
 * the game-over screen simply doesn't grow this section.
 */
export default function ComeBackTomorrowPanel({ className }: { className?: string }) {
  const [data, setData] = useState<ComebackData | null>(null);
  const guestCopy = guestLine(useGuestPromptV2Enabled(), useSaveAccountCopyEnabled());
  const guestReminders = useGuestPushRemindersEnabled();

  useEffect(() => {
    let cancelled = false;
    api.get('/progression/comeback')
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  const milestone = data.next_streak_milestone;
  const daysToMilestone = milestone ? milestone.day - data.daily_streak : null;

  return (
    <div className={`p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left space-y-2.5 ${className ?? ''}`}>
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Tomorrow awaits</p>

      {data.daily_streak > 0 && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Flame size={15} className="text-orange-400 mt-0.5 shrink-0" />
          <span>
            <span className="text-orange-300 font-medium">{data.daily_streak}-day play streak.</span>{' '}
            {milestone && daysToMilestone != null && (
              <>Play tomorrow — {daysToMilestone === 1
                ? <>the <span className="text-bf-gold">{milestone.gold}-gold milestone</span> is next</>
                : <>{daysToMilestone} days to the <span className="text-bf-gold">{milestone.gold}-gold milestone</span></>}.
              </>
            )}
            {data.is_guest && (
              <span className="text-bf-muted"> {guestCopy.statement} — {guestCopy.cta}.</span>
            )}
          </span>
        </p>
      )}

      {!data.is_guest && (data.streak_freezes ?? 0) > 0 && data.daily_streak > 0 && (
        <p className="text-xs text-sky-300/90 flex items-start gap-2">
          <Snowflake size={13} className="mt-0.5 shrink-0" />
          <span>
            {data.streak_freezes} streak freeze{data.streak_freezes === 1 ? '' : 's'} armed — one missed day
            won&apos;t break your streak.
          </span>
        </p>
      )}

      {!data.is_guest && data.tomorrow_login_reward != null && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Coins size={15} className="text-bf-gold mt-0.5 shrink-0" />
          <span>
            Tomorrow&apos;s login chest:{' '}
            <span className="text-bf-gold font-medium">{data.tomorrow_login_reward} gold</span>
            {data.already_claimed_today === false && ' (today’s is still unclaimed in the lobby)'}
          </span>
        </p>
      )}

      {/* Guests can play the daily too; this nudge is the funnel, not a perk. */}
      {!data.daily_challenge_done_today && (
        <p className="text-sm text-white/80 flex items-start gap-2">
          <Swords size={15} className="text-sky-300 mt-0.5 shrink-0" />
          <span>
            Today&apos;s <Link to="/daily" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">Daily Challenge</Link>{' '}
            is still open — a fresh one lands at midnight UTC.
          </span>
        </p>
      )}

      {/* Only with a streak: it is what the reminders protect, and a game that
          set none (a resignation) leaves the guest out of both of them. */}
      {data.is_guest && guestReminders && data.daily_streak > 0 && <ReminderAsk />}
    </div>
  );
}

/**
 * A guest's one way to hear from us: browser notifications (no email). Asked
 * here, at the end of a game with a streak just started, because the browser
 * shows its permission prompt only from a click. Shown only when the click can
 * lead somewhere, and "Not now" shares the 30-day snooze with the lobby card
 * and the after-turn prompt. On an iPhone tab, where web push exists only in a
 * Home Screen app, it gives that advice instead.
 */
function ReminderAsk() {
  const [status, setStatus] = useState(() => getWebPushStatus());
  const [dismissed, setDismissed] = useState(() => {
    const at = getPushNudgeDismissedAt();
    return at !== null && Date.now() - at < PUSH_NUDGE_SNOOZE_MS;
  });
  const [busy, setBusy] = useState(false);

  const iosTab = status === 'unsupported' && needsHomeScreenInstall();
  if (dismissed || (status !== 'default' && !iosTab)) return null;

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
        toast.success("We'll remind you before your streak ends");
      } else if (result === 'denied') {
        toast.error('Notifications are blocked for this site in your browser settings');
      } else if (result === 'error') {
        toast.error("Couldn't turn on reminders — try again from Settings");
      }
      // 'default': the prompt was closed without a choice; the row stays.
      setStatus(result === 'granted' || result === 'denied' ? result : getWebPushStatus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-1 space-y-2" role="region" aria-label="Reminders">
      <p className="text-sm text-white/80 flex items-start gap-2">
        <BellRing size={15} className="text-bf-gold mt-0.5 shrink-0" aria-hidden />
        <span>
          {iosTab
            ? 'Want a reminder tomorrow? Add Borderfall to your Home Screen (Share → Add to Home Screen), then turn notifications on in Settings there.'
            : 'Want a reminder tomorrow? One notification on this device before your streak ends, never more than one a day.'}
        </span>
      </p>
      <div className="flex items-center gap-2 pl-[23px]">
        {!iosTab && (
          <button type="button" className="btn-primary text-sm py-1.5" onClick={turnOn} disabled={busy}>
            {busy ? 'Turning on…' : 'Remind me'}
          </button>
        )}
        <button type="button" className="btn-secondary text-sm py-1.5" onClick={dismiss}>
          {iosTab ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

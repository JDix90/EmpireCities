import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Coins, Swords, Snowflake, BellRing, CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { enableWebPush, getWebPushStatus, needsHomeScreenInstall } from '../../services/pushNotifications';
import { guestLine } from '../../utils/guestGate';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';
import { PUSH_NUDGE_SNOOZE_MS } from '../notifications/PushOptInBanner';
import { useComebackHookEnabled, useGuestPromptV2Enabled, useGuestPushRemindersEnabled } from '../../store/featureFlagsStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { ownAuthUiAllowed } from '../../utils/embedContext';
import { useSaveAccountCopyEnabled } from '../../store/featureFlagsStore';
import { trackFunnel, useTrackShown } from '../../utils/funnelEvents';
import { InstallButton } from '../install/InstallOffer';

interface ComebackData {
  is_guest: boolean;
  daily_streak: number;
  played_today: boolean;
  next_streak_milestone: { day: number; gold: number } | null;
  tomorrow_login_reward: number | null;
  already_claimed_today: boolean | null;
  daily_challenge_done_today: boolean;
  streak_freezes: number | null;
  /** comeback_hook_enabled: tomorrow's Daily Challenge, named ahead (null when it cannot be had). */
  tomorrow_daily?: { date: string; title: string; era_id: string } | null;
  /** comeback_hook_enabled: players who finished yesterday's Daily Challenge. */
  daily_players_yesterday?: number | null;
}

/**
 * "Yesterday 14 commanders played it" is a reason to come; "yesterday 1
 * commander played it" is the opposite. Below this the count is left out.
 */
export const DAILY_PLAYERS_SHOWN_FROM = 5;

/**
 * The "come back tomorrow" moment on the game-over screen — the one place we
 * reliably have the player's attention at the end of a session. Shows the
 * streak they now have to protect, tomorrow's (bigger) login chest, and a
 * daily-challenge tease. Self-contained and fail-silent: if the fetch dies,
 * the game-over screen simply doesn't grow this section.
 */
export default function ComeBackTomorrowPanel({ className, won }: {
  className?: string;
  /** The viewer won the game this panel closes (comeback_hook_enabled asks for the reminder then). */
  won?: boolean;
}) {
  const [data, setData] = useState<ComebackData | null>(null);
  const guestCopy = guestLine(useGuestPromptV2Enabled(), useSaveAccountCopyEnabled());
  const guestReminders = useGuestPushRemindersEnabled();
  // comeback_hook_enabled: tomorrow's challenge leads, a guest's streak reads
  // without the gold a guest cannot spend, and the reminder ask follows a win.
  const hook = useComebackHookEnabled();

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
  // funnel_events_v2_enabled: the panel is the results screen's tomorrow hook;
  // shown, against the daily links pressed and the next day's return.
  useTrackShown({ event: 'tomorrow_panel_shown' }, !!data, {
    is_guest: String(!!data?.is_guest),
    daily_streak: String(data?.daily_streak ?? 0),
    daily_open: String(!!data && !data.daily_challenge_done_today),
    ...(hook ? { tomorrow_named: String(!!data?.tomorrow_daily) } : {}),
  });
  // The guest's save link in the streak line (comeback_hook_enabled).
  const guestSaveLink = hook && !!data?.is_guest && (data?.daily_streak ?? 0) > 0 && ownAuthUiAllowed();
  useTrackShown({ event: 'save_prompt_shown', surface: 'tomorrow' }, guestSaveLink);

  if (!data) return null;

  const milestone = data.next_streak_milestone;
  const daysToMilestone = milestone ? milestone.day - data.daily_streak : null;

  return (
    <div className={`p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left space-y-2.5 ${className ?? ''}`}>
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Tomorrow awaits</p>

      {/* The day's reason to come back, by name (comeback_hook_enabled). */}
      {hook && data.tomorrow_daily && (
        <p className="text-sm text-white/85 flex items-start gap-2" data-testid="tomorrow-daily">
          <CalendarClock size={15} className="text-sky-300 mt-0.5 shrink-0" aria-hidden />
          <span>
            Tomorrow&apos;s Daily Challenge:{' '}
            <span className="text-sky-200 font-medium">{data.tomorrow_daily.title}</span>
            <span>
              {ERA_LABELS[data.tomorrow_daily.era_id] ? ` · ${ERA_LABELS[data.tomorrow_daily.era_id]}` : ''}. It opens at midnight UTC.
            </span>
            {(data.daily_players_yesterday ?? 0) >= DAILY_PLAYERS_SHOWN_FROM && (
              <span className="text-white/55"> {data.daily_players_yesterday} commanders played yesterday&apos;s.</span>
            )}
          </span>
        </p>
      )}

      {hook && data.is_guest && data.daily_streak > 0 && (
        <p className="text-sm text-white/80 flex items-start gap-2" data-testid="tomorrow-guest-streak">
          <Flame size={15} className="text-orange-400 mt-0.5 shrink-0" />
          <span>
            <span className="text-orange-300 font-medium">{data.daily_streak}-day play streak.</span>{' '}
            Play tomorrow to make it {data.daily_streak + 1}.{' '}
            <span className="text-bf-muted">
              <span>{guestCopy.statement}</span>
              {guestSaveLink ? (
                <>
                  <span>{' — '}</span>
                  <Link
                    to="/upgrade"
                    className="text-bf-gold underline underline-offset-2 hover:text-bf-gold/80"
                    onClick={() => trackFunnel({ event: 'save_prompt_clicked', surface: 'tomorrow' })}
                  >
                    {guestCopy.cta}
                  </Link>
                </>
              ) : null}
              <span>.</span>
            </span>
          </span>
        </p>
      )}

      {data.daily_streak > 0 && !(hook && data.is_guest) && (
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
            Today&apos;s{' '}
            <Link
              to="/daily"
              className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
              onClick={() => trackFunnel({ event: 'daily_link_clicked', surface: 'tomorrow' })}
            >
              Daily Challenge
            </Link>{' '}
            is still open — a fresh one lands at midnight UTC.
          </span>
        </p>
      )}

      {/* Only with a streak: it is what the reminders protect, and a game that
          set none (a resignation) leaves the guest out of both of them. */}
      {data.is_guest && guestReminders && data.daily_streak > 0 && (!hook || won) && <ReminderAsk daily={hook} />}
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
function ReminderAsk({ daily = false }: { daily?: boolean }) {
  const [status, setStatus] = useState(() => getWebPushStatus());
  const [dismissed, setDismissed] = useState(() => {
    const at = getPushNudgeDismissedAt();
    return at !== null && Date.now() - at < PUSH_NUDGE_SNOOZE_MS;
  });
  const [busy, setBusy] = useState(false);

  const iosTab = status === 'unsupported' && needsHomeScreenInstall();
  // funnel_events_v2_enabled: the ask shown against dismissed.
  useTrackShown({ event: 'push_ask_shown', surface: 'results' }, !dismissed && (status === 'default' || iosTab), { ios_tab: String(iosTab) });
  if (dismissed || (status !== 'default' && !iosTab)) return null;

  const dismiss = () => {
    trackFunnel({ event: 'push_ask_dismissed', surface: 'results' }, { ios_tab: String(iosTab) });
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
            : daily
              // What the reminders actually send (backend retentionNotificationWorker):
              // the day's challenge at 17:00 UTC, or the streak about to end; one a day.
              ? 'Want a reminder tomorrow? One notification on this device, never more than one a day: when the new Daily Challenge is up, or before your streak runs out.'
              : 'Want a reminder tomorrow? One notification on this device before your streak ends, never more than one a day.'}
        </span>
      </p>
      <div className="flex items-center gap-2 pl-[23px]">
        {!iosTab && (
          <button type="button" className="btn-primary text-sm py-1.5" onClick={turnOn} disabled={busy}>
            {busy ? 'Turning on…' : 'Remind me'}
          </button>
        )}
        {iosTab && <InstallButton surface="push_ask" label="Show me how" />}
        <button type="button" className="btn-secondary text-sm py-1.5" onClick={dismiss}>
          {iosTab ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  );
}

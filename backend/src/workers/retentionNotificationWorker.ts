// ============================================================
// Retention Notification Worker — scheduled re-engagement
// ============================================================
// Hourly BullMQ repeatable job (multi-instance safe: the job
// scheduler is deduped in Redis, and each send is claimed with an
// INSERT .. ON CONFLICT DO NOTHING before dispatch). Sends, in
// priority order:
//   0) your game is waiting       — a solo game left unfinished a day ago
//                                   (game_waiting_reminder_enabled)
//   a) streak-at-risk push        — played yesterday, not yet today
//   b) daily-challenge reminder   — recently active, no entry today
//   c) D2 / D7 win-back email     — lapsed, email opt-in only
// Hard guarantees: max ONE outbound notification per user per UTC
// day (UNIQUE (user_id, sent_on) in retention_notifications), all
// queries exclude banned users, and guests unless
// guest_push_reminders_enabled lets push reach them (never email),
// emails only go to email_notifications opt-ins, and each phase is
// capped per sweep so a query bug can never blast the whole user table.
// ============================================================

import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { featureFlags } from '../config/featureFlags';
import { query, queryOne } from '../db/postgres';
import { isPushConfigured, sendPushNotification, sendEngagementEmail } from '../services/notificationService';
import { recordServerEvent } from '../services/analyticsEvents';
import { APP_NAME } from '../constants/brand';
import { notPlayOnSql, notTutorialSql } from '../game-engine/tutorial/tutorialGames';
import { escapeHtml } from '../utils/htmlSafe';

const QUEUE_NAME = 'retention-notifications';
const SCHEDULER_ID = 'retention-hourly';

/** Per-trigger, per-sweep candidate cap — a safety valve, not a target. */
const SWEEP_LIMIT = 500;

/** UTC hour gates for the once-a-day phases (streak-at-risk runs every hour). */
const DAILY_CHALLENGE_UTC_HOUR = 17;
const WINBACK_UTC_HOUR = 15;

type RetentionTrigger = 'game_waiting' | 'streak_at_risk' | 'daily_challenge' | 'winback_d2' | 'winback_d7';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

export const retentionQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1, // never retry a sweep — the next hourly run picks up anyone missed
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

type Candidate = {
  user_id: string;
  daily_streak: number;
  push_enabled: boolean;
  email_enabled: boolean;
  /** The player has at least one device registered for push. */
  has_push_token: boolean;
};

/**
 * SQL: the player opted in to email. Only an account has an address; a guest's
 * placeholder ends in @guest.local, and sendEngagementEmail refuses it.
 */
const EMAIL_OPT_IN_SQL = `(COALESCE(u.is_guest, false) = false AND COALESCE(p.email_notifications, false))`;

/** The candidate columns every phase selects. */
const CANDIDATE_COLUMNS = `u.user_id, COALESCE(u.daily_streak, 0) AS daily_streak,
            COALESCE(p.push_enabled, true) AS push_enabled,
            ${EMAIL_OPT_IN_SQL} AS email_enabled,
            EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = u.user_id) AS has_push_token`;

/**
 * SQL: the player can be reached by push. `$1` is whether this server can send
 * push at all (isPushConfigured), so without Firebase no one counts.
 */
const PUSH_REACHABLE_SQL = `($1::boolean
         AND COALESCE(p.push_enabled, true)
         AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = u.user_id))`;

/**
 * SQL: an account, or a guest while `$2` (guest_push_reminders_enabled) is on.
 * A guest has no email (EMAIL_OPT_IN_SQL), so a guest is reached by push or
 * not at all, and is never a win-back candidate.
 */
const ACCOUNT_OR_ALLOWED_GUEST_SQL = `(COALESCE(u.is_guest, false) = false OR $2::boolean)`;

/**
 * Claim the user's one-per-day notification slot. Returns false when someone
 * (this sweep, an earlier phase, or another instance) already claimed today.
 */
async function claimSlot(userId: string, trigger: RetentionTrigger, channel: 'push' | 'email'): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO retention_notifications (user_id, trigger_type, channel)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, sent_on) DO NOTHING
     RETURNING id`,
    [userId, trigger, channel],
  );
  return Boolean(row);
}

async function markResult(userId: string, channel: 'push' | 'email', delivered: boolean): Promise<void> {
  await query(
    `UPDATE retention_notifications
     SET channel = $2, delivery_status = $3
     WHERE user_id = $1 AND sent_on = CURRENT_DATE`,
    [userId, channel, delivered ? 'sent' : 'failed'],
  ).catch(() => {});
}

/**
 * Push-first dispatch with email fallback. The slot is claimed BEFORE any
 * send: on failure we keep the claim and mark it failed rather than retrying —
 * under-sending beats double-sending for re-engagement mail.
 */
async function dispatchPushFirst(
  c: Candidate,
  trigger: RetentionTrigger,
  push: { title: string; body: string; url: string },
  email: { subject: string; innerHtml: string } | null,
  pushReady: boolean,
): Promise<boolean> {
  const canPush = pushReady && c.push_enabled && c.has_push_token;
  const canEmail = email !== null && c.email_enabled;
  // A reminder the player cannot receive must not take their one slot for the
  // day. The push-only daily-challenge reminder at 17:00 UTC used to claim it
  // for every player with no device, and the streak reminder due later that
  // day then skipped them: an opted-in player's streak email never went out.
  if (!canPush && !canEmail) return false;
  if (!(await claimSlot(c.user_id, trigger, 'push'))) return false;

  if (canPush) {
    const sent = await sendPushNotification(c.user_id, push.title, push.body, { url: push.url }, push.url);
    if (sent > 0) {
      recordServerEvent('retention_notification_sent', { trigger, channel: 'push' }, c.user_id);
      return true;
    }
  }
  // Unreachable by push (disabled, no tokens, or FCM failure) → email fallback.
  if (email && canEmail) {
    const delivered = await sendEngagementEmail(c.user_id, email.subject, email.innerHtml);
    await markResult(c.user_id, 'email', delivered);
    if (delivered) {
      recordServerEvent('retention_notification_sent', { trigger, channel: 'email' }, c.user_id);
      return true;
    }
    return false;
  }
  await markResult(c.user_id, 'push', false);
  return false;
}

async function dispatchEmail(c: Candidate, trigger: RetentionTrigger, subject: string, innerHtml: string): Promise<boolean> {
  if (!(await claimSlot(c.user_id, trigger, 'email'))) return false;
  const delivered = await sendEngagementEmail(c.user_id, subject, innerHtml);
  if (delivered) {
    recordServerEvent('retention_notification_sent', { trigger, channel: 'email' }, c.user_id);
  } else {
    await markResult(c.user_id, 'email', false);
  }
  return delivered;
}

function ctaButton(url: string, label: string): string {
  return `<a href="${url}"
     style="display: inline-block; padding: 12px 24px; background: #d4a843; color: #0f1117;
            text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 12px;">${label}</a>`;
}

function trackedUrl(path: string, trigger: RetentionTrigger): string {
  return `${config.frontendUrl}${path}?rn=${trigger}&utm_source=retention&utm_medium=notification&utm_campaign=${trigger}`;
}

// ── Phase 0: your game is waiting (all hours, push-first) ────────────────────
// Most first matches are never finished, and most are left in their first
// round with the tab closed: the game is still there, in progress, but the
// player never sees it again unless they come back to the lobby on their own.
// A player whose latest game is an unfinished solo game against bots, left 20
// to 48 hours ago, gets one reminder that links straight back into it, the
// same time of day the streak reminder aims for (see phase a). It runs first:
// it is the most specific thing a player can be told. Live game state is kept
// in Redis for seven days (sockets/redisGameStore.ts), so a game left two days
// ago opens where it stopped.

type WaitingCandidate = Candidate & {
  game_id: string;
  /** The map's display name, when the map is in the maps table. */
  map_name: string | null;
  /** The game is the player's first match (settings `first_match`). */
  first_match: boolean;
};

/** Exported for tests. */
export async function sweepGameWaiting(pushReady: boolean, guests: boolean): Promise<number> {
  const candidates = await query<WaitingCandidate>(
    `WITH waiting AS (
       SELECT gp.user_id, g.game_id, g.created_at, m.name AS map_name,
              COALESCE(g.settings_json ->> 'first_match', 'false') = 'true' AS first_match,
              COALESCE(
                (SELECT MAX(gs.saved_at) FROM game_states gs WHERE gs.game_id = g.game_id),
                g.started_at
              ) AS last_activity
       FROM games g
       JOIN game_players gp ON gp.game_id = g.game_id AND gp.is_ai = false AND gp.user_id IS NOT NULL
       LEFT JOIN maps m ON m.map_id = g.map_id
       WHERE g.status = 'in_progress'
         AND g.started_at >= NOW() - INTERVAL '3 days'
         AND COALESCE(gp.is_eliminated, false) = false
         AND ${notTutorialSql('g')}
         AND ${notPlayOnSql('g')}
         AND COALESCE(g.settings_json ->> 'daily_challenge_date', '') = ''
         AND COALESCE(g.async_mode, false) = false
         -- One player against bots: a table of people has its own turn alerts.
         AND NOT EXISTS (
           SELECT 1 FROM game_players other
           WHERE other.game_id = g.game_id AND other.is_ai = false
             AND other.user_id IS DISTINCT FROM gp.user_id
         )
     )
     SELECT ${CANDIDATE_COLUMNS}, w.game_id, w.map_name, w.first_match
     FROM waiting w
     JOIN users u ON u.user_id = w.user_id
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE w.last_activity BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '20 hours'
       AND ${ACCOUNT_OR_ALLOWED_GUEST_SQL}
       AND COALESCE(u.is_banned, false) = false
       -- Not back on the site since: a player who came back and left the game
       -- where it was has already seen it.
       AND u.last_login_at <= NOW() - INTERVAL '20 hours'
       AND (${PUSH_REACHABLE_SQL} OR ${EMAIL_OPT_IN_SQL})
       -- Their latest game: they have not moved on to another.
       AND NOT EXISTS (
         SELECT 1 FROM game_players gp2 JOIN games g2 ON g2.game_id = gp2.game_id
         WHERE gp2.user_id = u.user_id AND g2.created_at > w.created_at
       )
       -- Once per game: no reminder of this kind since they left it.
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.trigger_type = 'game_waiting'
           AND rn.sent_at >= w.last_activity
       )
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
    [pushReady, guests],
  );

  let sent = 0;
  for (const c of candidates) {
    const url = trackedUrl(`/game/${c.game_id}`, 'game_waiting');
    // A community map's name is a player's text: one line in the push and the
    // subject, escaped in the email body.
    // Led by the map's name, which reads whatever it is ("The Modern Day").
    const mapName = c.map_name ? c.map_name.replace(/\s+/g, ' ').trim() : '';
    const ok = await dispatchPushFirst(
      c,
      'game_waiting',
      {
        title: c.first_match ? 'Your first match is waiting' : 'Your game is waiting',
        body: `${mapName ? `${mapName}: your` : 'Your'} battle is right where you left it. Pick it up in one tap.`,
        url,
      },
      {
        subject: `Your battle is waiting${mapName ? `: ${mapName}` : ''}`,
        innerHtml: `
          <h2 style="color: #d4a843;">Your armies are holding their positions</h2>
          <p>You left a game unfinished${mapName ? ` (<strong>${escapeHtml(mapName)}</strong>)` : ''}.
             It is exactly where you left it.</p>
          ${ctaButton(url, 'Resume My Game')}
        `,
      },
      pushReady,
    );
    if (ok) sent++;
  }
  return sent;
}

// ── Phase a: streak-at-risk (all hours, push-first) ──────────────────────────
// `last_login_at <= NOW() - 20h` approximates "same time of day as their last
// session" without stored timezones: combined with the hourly sweep and the
// one-per-day claim, the reminder lands ~20–24h after they last played and
// never pings someone who was on the site within the last 20 hours. All date
// math is UTC on purpose — updateDailyStreak keys streaks on UTC dates, so the
// reminder and the streak logic always agree on what "today" means.
async function sweepStreakAtRisk(pushReady: boolean, guests: boolean): Promise<number> {
  // Only players a push or an email can reach: the rest are never claimed, so
  // left in they would come back every hour and could fill SWEEP_LIMIT.
  const candidates = await query<Candidate>(
    `SELECT ${CANDIDATE_COLUMNS}
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE ${ACCOUNT_OR_ALLOWED_GUEST_SQL}
       AND COALESCE(u.is_banned, false) = false
       AND COALESCE(u.daily_streak, 0) >= 1
       AND u.last_played_date = CURRENT_DATE - 1
       AND u.last_login_at <= NOW() - INTERVAL '20 hours'
       AND (${PUSH_REACHABLE_SQL} OR ${EMAIL_OPT_IN_SQL})
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
    [pushReady, guests],
  );

  let sent = 0;
  for (const c of candidates) {
    const url = trackedUrl('/lobby', 'streak_at_risk');
    const ok = await dispatchPushFirst(
      c,
      'streak_at_risk',
      {
        title: `🔥 Your ${c.daily_streak}-day streak is at risk`,
        body: `It ends at midnight UTC — play one game to keep it going.`,
        url,
      },
      {
        subject: `🔥 Your ${c.daily_streak}-day ${APP_NAME} streak ends tonight`,
        innerHtml: `
          <h2 style="color: #d4a843;">Your streak is on the line</h2>
          <p>You've played <strong>${c.daily_streak} day${c.daily_streak === 1 ? '' : 's'} in a row</strong>.
             The streak resets at midnight UTC — one quick game keeps it alive.</p>
          ${ctaButton(url, 'Keep My Streak')}
        `,
      },
      pushReady,
    );
    if (ok) sent++;
  }
  return sent;
}

// ── Phase b: daily-challenge reminder (one UTC hour, push-first) ─────────────
async function sweepDailyChallenge(pushReady: boolean, guests: boolean): Promise<number> {
  // Push only, so only players a push can reach.
  const candidates = await query<Candidate>(
    `SELECT ${CANDIDATE_COLUMNS}
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE ${ACCOUNT_OR_ALLOWED_GUEST_SQL}
       AND COALESCE(u.is_banned, false) = false
       AND u.last_played_date BETWEEN CURRENT_DATE - 3 AND CURRENT_DATE - 1
       AND ${PUSH_REACHABLE_SQL}
       AND NOT EXISTS (
         SELECT 1 FROM daily_challenge_entries dce
         WHERE dce.user_id = u.user_id AND dce.challenge_date = CURRENT_DATE
       )
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
    [pushReady, guests],
  );

  let sent = 0;
  for (const c of candidates) {
    const url = trackedUrl('/daily', 'daily_challenge');
    const ok = await dispatchPushFirst(
      c,
      'daily_challenge',
      {
        title: "Today's Daily Challenge is live",
        body: 'A fresh puzzle, a few minutes — beat it before it rotates at midnight UTC.',
        url,
      },
      null, // push-only: a missed daily puzzle isn't worth an email
      pushReady,
    );
    if (ok) sent++;
  }
  return sent;
}

// ── Phase c: D2 / D7 win-back (one UTC hour, email, opt-in only) ─────────────
async function sweepWinback(daysAgo: 2 | 7): Promise<number> {
  const trigger: RetentionTrigger = daysAgo === 2 ? 'winback_d2' : 'winback_d7';
  const candidates = await query<Candidate>(
    `SELECT ${CANDIDATE_COLUMNS}
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE COALESCE(u.is_guest, false) = false
       AND COALESCE(u.is_banned, false) = false
       AND u.email NOT LIKE '%@guest.local'
       AND COALESCE(p.email_notifications, false) = true
       AND u.last_played_date = CURRENT_DATE - ${daysAgo}
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
  );

  const url = trackedUrl('/lobby', trigger);
  let sent = 0;
  for (const c of candidates) {
    const ok = daysAgo === 2
      ? await dispatchEmail(c, trigger, `Your empire misses you, Commander`, `
          <h2 style="color: #d4a843;">Your armies await orders</h2>
          <p>It's been two days since your last campaign. The map has moved on —
             one quick game puts you back on it.</p>
          ${ctaButton(url, 'Return to Battle')}
        `)
      : await dispatchEmail(c, trigger, `A week without conquest — your borders are getting nervous`, `
          <h2 style="color: #d4a843;">The world kept turning</h2>
          <p>Seven days since your last game. There's a fresh Daily Challenge
             every day and your rank is waiting to be defended.</p>
          ${ctaButton(url, 'Reclaim Your Empire')}
        `);
    if (ok) sent++;
  }
  return sent;
}

// ── Sweep orchestration ──────────────────────────────────────────────────────

/** Exported for tests. Runs one hourly sweep; phase order IS the priority order. */
export async function runRetentionSweep(
  nowUtcHour?: number,
): Promise<{ waiting: number; streak: number; daily: number; winback: number }> {
  if (!featureFlags.retentionNotificationsEnabled) {
    return { waiting: 0, streak: 0, daily: 0, winback: 0 };
  }
  const hour = nowUtcHour ?? new Date().getUTCHours();
  const pushReady = await isPushConfigured();
  const guests = featureFlags.guestPushRemindersEnabled;

  const waiting = featureFlags.gameWaitingReminderEnabled ? await sweepGameWaiting(pushReady, guests) : 0;
  const streak = await sweepStreakAtRisk(pushReady, guests);
  const daily = hour === DAILY_CHALLENGE_UTC_HOUR ? await sweepDailyChallenge(pushReady, guests) : 0;
  let winback = 0;
  if (hour === WINBACK_UTC_HOUR) {
    winback = (await sweepWinback(2)) + (await sweepWinback(7));
  }

  if (waiting + streak + daily + winback > 0) {
    console.log(`[Retention] Sweep sent: waiting=${waiting} streak=${streak} daily=${daily} winback=${winback}`);
  }
  return { waiting, streak, daily, winback };
}

let worker: Worker | null = null;

export async function startRetentionNotificationWorker(): Promise<void> {
  // Repeatable job — upsert is idempotent across instances and restarts.
  await retentionQueue.upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: '5 * * * *' }, // hh:05 every hour, offset from other on-the-hour work
    { name: 'retention-sweep' },
  );

  worker = new Worker(
    QUEUE_NAME,
    async () => {
      await runRetentionSweep();
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Retention] Sweep failed: ${job?.id}`, err);
  });

  console.log('[Retention] Worker started (hourly sweep; sends gated by retention_notifications_enabled)');
}

export async function stopRetentionNotificationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await retentionQueue.close();
  console.log('[Retention] Worker stopped');
}

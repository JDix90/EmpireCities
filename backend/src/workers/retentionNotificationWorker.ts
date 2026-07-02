// ============================================================
// Retention Notification Worker — scheduled re-engagement
// ============================================================
// Hourly BullMQ repeatable job (multi-instance safe: the job
// scheduler is deduped in Redis, and each send is claimed with an
// INSERT .. ON CONFLICT DO NOTHING before dispatch). Sends, in
// priority order:
//   a) streak-at-risk push        — played yesterday, not yet today
//   b) daily-challenge reminder   — recently active, no entry today
//   c) D2 / D7 win-back email     — lapsed, email opt-in only
// Hard guarantees: max ONE outbound notification per user per UTC
// day (UNIQUE (user_id, sent_on) in retention_notifications), all
// queries exclude guests and banned users, emails only go to
// email_notifications opt-ins, and each phase is capped per sweep
// so a query bug can never blast the whole user table.
// ============================================================

import { Queue, Worker } from 'bullmq';
import { config } from '../config';
import { featureFlags } from '../config/featureFlags';
import { query, queryOne } from '../db/postgres';
import { sendPushNotification, sendEngagementEmail } from '../services/notificationService';
import { recordServerEvent } from '../services/analyticsEvents';
import { APP_NAME } from '../constants/brand';

const QUEUE_NAME = 'retention-notifications';
const SCHEDULER_ID = 'retention-hourly';

/** Per-trigger, per-sweep candidate cap — a safety valve, not a target. */
const SWEEP_LIMIT = 500;

/** UTC hour gates for the once-a-day phases (streak-at-risk runs every hour). */
const DAILY_CHALLENGE_UTC_HOUR = 17;
const WINBACK_UTC_HOUR = 15;

type RetentionTrigger = 'streak_at_risk' | 'daily_challenge' | 'winback_d2' | 'winback_d7';

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
};

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
): Promise<boolean> {
  if (!(await claimSlot(c.user_id, trigger, 'push'))) return false;

  if (c.push_enabled) {
    const sent = await sendPushNotification(c.user_id, push.title, push.body, { url: push.url }, push.url);
    if (sent > 0) {
      recordServerEvent('retention_notification_sent', { trigger, channel: 'push' }, c.user_id);
      return true;
    }
  }
  // Unreachable by push (disabled, no tokens, or FCM failure) → email fallback.
  if (email && c.email_enabled) {
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

// ── Phase a: streak-at-risk (all hours, push-first) ──────────────────────────
// `last_login_at <= NOW() - 20h` approximates "same time of day as their last
// session" without stored timezones: combined with the hourly sweep and the
// one-per-day claim, the reminder lands ~20–24h after they last played and
// never pings someone who was on the site within the last 20 hours. All date
// math is UTC on purpose — updateDailyStreak keys streaks on UTC dates, so the
// reminder and the streak logic always agree on what "today" means.
async function sweepStreakAtRisk(): Promise<number> {
  const candidates = await query<Candidate>(
    `SELECT u.user_id, COALESCE(u.daily_streak, 0) AS daily_streak,
            COALESCE(p.push_enabled, true) AS push_enabled,
            COALESCE(p.email_notifications, false) AS email_enabled
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE COALESCE(u.is_guest, false) = false
       AND COALESCE(u.is_banned, false) = false
       AND COALESCE(u.daily_streak, 0) >= 1
       AND u.last_played_date = CURRENT_DATE - 1
       AND u.last_login_at <= NOW() - INTERVAL '20 hours'
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
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
    );
    if (ok) sent++;
  }
  return sent;
}

// ── Phase b: daily-challenge reminder (one UTC hour, push-first) ─────────────
async function sweepDailyChallenge(): Promise<number> {
  const candidates = await query<Candidate>(
    `SELECT u.user_id, COALESCE(u.daily_streak, 0) AS daily_streak,
            COALESCE(p.push_enabled, true) AS push_enabled,
            COALESCE(p.email_notifications, false) AS email_enabled
     FROM users u
     LEFT JOIN user_preferences p ON p.user_id = u.user_id
     WHERE COALESCE(u.is_guest, false) = false
       AND COALESCE(u.is_banned, false) = false
       AND u.last_played_date BETWEEN CURRENT_DATE - 3 AND CURRENT_DATE - 1
       AND NOT EXISTS (
         SELECT 1 FROM daily_challenge_entries dce
         WHERE dce.user_id = u.user_id AND dce.challenge_date = CURRENT_DATE
       )
       AND NOT EXISTS (
         SELECT 1 FROM retention_notifications rn
         WHERE rn.user_id = u.user_id AND rn.sent_on = CURRENT_DATE
       )
     LIMIT ${SWEEP_LIMIT}`,
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
    );
    if (ok) sent++;
  }
  return sent;
}

// ── Phase c: D2 / D7 win-back (one UTC hour, email, opt-in only) ─────────────
async function sweepWinback(daysAgo: 2 | 7): Promise<number> {
  const trigger: RetentionTrigger = daysAgo === 2 ? 'winback_d2' : 'winback_d7';
  const candidates = await query<Candidate>(
    `SELECT u.user_id, COALESCE(u.daily_streak, 0) AS daily_streak,
            COALESCE(p.push_enabled, true) AS push_enabled,
            COALESCE(p.email_notifications, false) AS email_enabled
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
export async function runRetentionSweep(nowUtcHour?: number): Promise<{ streak: number; daily: number; winback: number }> {
  if (!featureFlags.retentionNotificationsEnabled) {
    return { streak: 0, daily: 0, winback: 0 };
  }
  const hour = nowUtcHour ?? new Date().getUTCHours();

  const streak = await sweepStreakAtRisk();
  const daily = hour === DAILY_CHALLENGE_UTC_HOUR ? await sweepDailyChallenge() : 0;
  let winback = 0;
  if (hour === WINBACK_UTC_HOUR) {
    winback = (await sweepWinback(2)) + (await sweepWinback(7));
  }

  if (streak + daily + winback > 0) {
    console.log(`[Retention] Sweep sent: streak=${streak} daily=${daily} winback=${winback}`);
  }
  return { streak, daily, winback };
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

// ============================================================
// Notification Service — Push (FCM) + Email (Nodemailer)
// ============================================================
// Dispatches notifications for async games when it's a player's
// turn. Includes deduplication to avoid spamming on reconnects.
// ============================================================

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config';
import { query, queryOne } from '../db/postgres';
import type { GameState } from '../types';
import { APP_NAME } from '../constants/brand';
import { signUnsubscribeToken } from '../utils/unsubscribeToken';

// ── Era labels for notification text ─────────────────────────────────────────

const ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient Era',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern Era',
  acw: 'American Civil War',
  risorgimento: 'Risorgimento',
  custom: 'Custom Map',
};

// ── Firebase Admin (lazy-loaded, optional) ───────────────────────────────────

let firebaseApp: import('firebase-admin').app.App | null = null;
let firebaseInitAttempted = false;

async function getFirebaseAdmin(): Promise<typeof import('firebase-admin') | null> {
  if (firebaseInitAttempted) return firebaseApp ? (await import('firebase-admin')).default : null;
  firebaseInitAttempted = true;

  const saPath = config.push.fcmServiceAccountPath;
  if (!saPath) {
    console.log('[Notifications] FCM_SERVICE_ACCOUNT_PATH not set; push notifications disabled');
    return null;
  }

  try {
    const admin = (await import('firebase-admin')).default;
    const { readFileSync } = await import('fs');
    const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('[Notifications] Firebase Admin initialized');
    return admin;
  } catch (err) {
    console.error('[Notifications] Failed to init Firebase Admin:', err);
    return null;
  }
}

// ── SMTP Transporter (lazy-loaded, optional) ─────────────────────────────────

let smtpTransporter: Transporter | null = null;
let smtpInitAttempted = false;

/** Exported for auth password-reset and other transactional mail. */
export function getSmtpTransporter(): Transporter | null {
  if (smtpInitAttempted) return smtpTransporter;
  smtpInitAttempted = true;

  if (!config.smtp.host || !config.smtp.user) {
    console.log('[Notifications] SMTP not configured; email notifications disabled');
    return null;
  }

  try {
    smtpTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
    console.log('[Notifications] SMTP transporter created');
    return smtpTransporter;
  } catch (err) {
    console.error('[Notifications] Failed to create SMTP transporter:', err);
    return null;
  }
}

// ── Push Notifications ───────────────────────────────────────────────────────

/**
 * @param link click-through URL for web push (defaults to the lobby).
 * @returns number of device tokens the message was accepted for — 0 means the
 *          user is unreachable by push (no tokens, FCM down, or send failed),
 *          which callers can use to fall back to email.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  link?: string,
): Promise<number> {
  const admin = await getFirebaseAdmin();
  if (!admin) return 0;

  const tokens = await query<{ token_id: string; token: string }>(
    'SELECT token_id, token FROM push_tokens WHERE user_id = $1',
    [userId],
  );

  if (tokens.length === 0) return 0;

  const tokenStrings = tokens.map((t) => t.token);
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenStrings,
      notification: { title, body },
      data: data ?? {},
      webpush: {
        fcmOptions: { link: link ?? `${config.frontendUrl}/lobby` },
      },
    });

    // Clean up stale tokens
    if (response.failureCount > 0) {
      for (let i = 0; i < response.responses.length; i++) {
        const r = response.responses[i];
        if (r.error && (
          r.error.code === 'messaging/registration-token-not-registered' ||
          r.error.code === 'messaging/invalid-registration-token'
        )) {
          await query('DELETE FROM push_tokens WHERE token_id = $1', [tokens[i].token_id]);
        }
      }
    }
    return response.successCount;
  } catch (err) {
    console.error('[Notifications] Push send failed:', err);
    return 0;
  }
}

// ── Email delivery (Resend HTTP API or SMTP) ─────────────────────────────────
// All email goes through deliverEmail(), which picks the transport based on
// config.email.provider. 'resend_api' sends over HTTPS (port 443) and avoids
// the blocked-outbound-SMTP-port problem common on cloud hosts; any other value
// falls back to the existing SMTP path. Both return a boolean: true if accepted.

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_SEND_TIMEOUT_MS = 10_000;

/** True if the currently selected email provider has the credentials it needs. */
function isEmailConfigured(): boolean {
  if (config.email.provider === 'resend_api') {
    return Boolean(config.email.resendApiKey && config.smtp.from);
  }
  return Boolean(config.smtp.host && config.smtp.user);
}

/** Send via the Resend HTTP API over HTTPS. Returns true if accepted. */
async function sendViaResendApi(to: string, subject: string, htmlBody: string, listUnsubscribeUrl?: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.smtp.from,
        to: [to],
        subject,
        html: htmlBody,
        ...(listUnsubscribeUrl
          ? { headers: { 'List-Unsubscribe': `<${listUnsubscribeUrl}>` } }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[Notifications] Resend API send failed: HTTP ${res.status} ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Notifications] Resend API send error:', err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Send via SMTP (Nodemailer). Returns true if accepted. */
async function sendViaSmtp(to: string, subject: string, htmlBody: string, listUnsubscribeUrl?: string): Promise<boolean> {
  const transporter = getSmtpTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject,
      html: htmlBody,
      ...(listUnsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${listUnsubscribeUrl}>` } } : {}),
    });
    return true;
  } catch (err) {
    console.error('[Notifications] SMTP send failed:', err);
    return false;
  }
}

/** Unified email dispatch. Picks transport by config.email.provider. */
async function deliverEmail(to: string, subject: string, htmlBody: string, listUnsubscribeUrl?: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log('[Notifications] Email not configured; skipping send');
    return false;
  }
  return config.email.provider === 'resend_api'
    ? sendViaResendApi(to, subject, htmlBody, listUnsubscribeUrl)
    : sendViaSmtp(to, subject, htmlBody, listUnsubscribeUrl);
}

// ── Engagement email layout ──────────────────────────────────────────────────

/** One-click opt-out URL for a user's engagement email (see UnsubscribePage). */
export function unsubscribeUrlFor(userId: string): string {
  return `${config.frontendUrl}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(userId))}`;
}

/**
 * Shared chrome for every non-transactional (engagement) email. The
 * unsubscribe footer is mandatory: these emails are sent to users who opted
 * in, and one click must always get them back out.
 */
export function renderEmailLayout(innerHtml: string, unsubscribeUrl: string): string {
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      ${innerHtml}
      <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #333; font-size: 12px; color: #888;">
        You're receiving this because you opted into ${APP_NAME} gameplay emails.
        <a href="${unsubscribeUrl}" style="color: #888;">Unsubscribe</a> ·
        <a href="${config.frontendUrl}/settings" style="color: #888;">Notification settings</a>
      </p>
    </div>
  `;
}

/**
 * Send an engagement email (streak reminder, win-back, …) to a user, wrapped
 * in the shared layout with their unsubscribe link. The caller is responsible
 * for checking email_notifications consent first.
 * @returns whether the provider accepted the send.
 */
export async function sendEngagementEmail(
  userId: string,
  subject: string,
  innerHtml: string,
): Promise<boolean> {
  const user = await queryOne<{ email: string | null }>(
    'SELECT email FROM users WHERE user_id = $1',
    [userId],
  );
  if (!user?.email || user.email.toLowerCase().endsWith('@guest.local')) return false;
  const unsubscribeUrl = unsubscribeUrlFor(userId);
  return deliverEmail(user.email, subject, renderEmailLayout(innerHtml, unsubscribeUrl), unsubscribeUrl);
}

// ── Email Notifications ──────────────────────────────────────────────────────

/**
 * Send a transactional email to a raw address (password reset, etc.).
 * @returns whether the provider accepted the send; `false` if unavailable or send threw.
 */
export async function sendTransactionalEmailToAddress(
  to: string,
  subject: string,
  htmlBody: string,
): Promise<boolean> {
  return deliverEmail(to, subject, htmlBody);
}

// ── Turn Change Orchestrator ─────────────────────────────────────────────────

const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Notify a player that it's their turn in an async game.
 * Respects user preferences and applies throttling.
 */
export async function notifyTurnChange(
  gameId: string,
  currentPlayerId: string,
  gameState: GameState,
): Promise<void> {
  // Don't notify AI players
  const player = gameState.players.find((p) => p.player_id === currentPlayerId);
  if (!player || player.is_ai) return;

  // Throttle: check if we already notified this player for this game recently
  const recent = await queryOne<{ sent_at: Date }>(
    `SELECT sent_at FROM async_notifications
     WHERE game_id = $1 AND user_id = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [gameId, currentPlayerId],
  );
  if (recent && Date.now() - new Date(recent.sent_at).getTime() < THROTTLE_WINDOW_MS) {
    return; // Already notified recently
  }

  // Load user preferences (default: push on, email off)
  const prefs = await queryOne<{ push_enabled: boolean; email_notifications: boolean }>(
    'SELECT push_enabled, email_notifications FROM user_preferences WHERE user_id = $1',
    [currentPlayerId],
  );
  const pushEnabled = prefs?.push_enabled ?? true;
  const emailEnabled = prefs?.email_notifications ?? false;

  const eraLabel = ERA_LABELS[gameState.era] ?? APP_NAME;
  const deadlineSec = gameState.settings.async_turn_deadline_seconds ?? 86400;
  const deadlineHours = Math.round(deadlineSec / 3600);
  const deadlineLabel = deadlineHours >= 24
    ? `${Math.round(deadlineHours / 24)} day${deadlineHours >= 48 ? 's' : ''}`
    : `${deadlineHours} hours`;

  const title = "It's your turn!";
  const body = `${eraLabel} — Turn ${gameState.turn_number}. You have ${deadlineLabel} to play.`;
  const gameUrl = `${config.frontendUrl}/game/${gameId}`;

  // Send push notification — click through to the game, not the lobby
  if (pushEnabled) {
    await sendPushNotification(currentPlayerId, title, body, { gameId, url: gameUrl }, gameUrl);
  }

  // Send email notification
  if (emailEnabled) {
    const unsubscribeUrl = unsubscribeUrlFor(currentPlayerId);
    const inner = `
      <h2 style="color: #d4a843;">It's Your Turn!</h2>
      <p><strong>${eraLabel}</strong> — Turn ${gameState.turn_number}</p>
      <p>You have <strong>${deadlineLabel}</strong> to make your move.</p>
      <a href="${gameUrl}"
         style="display: inline-block; padding: 12px 24px; background: #d4a843; color: #0f1117;
                text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 12px;">
        Play Now
      </a>
    `;
    const user = await queryOne<{ email: string | null }>(
      'SELECT email FROM users WHERE user_id = $1',
      [currentPlayerId],
    );
    if (user?.email) {
      await deliverEmail(
        user.email,
        `${title} — ${eraLabel}`,
        renderEmailLayout(inner, unsubscribeUrl),
        unsubscribeUrl,
      );
    }
  }

  // Log notification
  const channel = [pushEnabled && 'push', emailEnabled && 'email'].filter(Boolean).join(',') || 'none';
  await query(
    `INSERT INTO async_notifications (game_id, user_id, type, channel, delivery_status)
     VALUES ($1, $2, 'your_turn', $3, 'sent')`,
    [gameId, currentPlayerId, channel],
  );
}

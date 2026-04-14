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

function getSmtpTransporter(): Transporter | null {
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

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const admin = await getFirebaseAdmin();
  if (!admin) return;

  const tokens = await query<{ token_id: string; token: string }>(
    'SELECT token_id, token FROM push_tokens WHERE user_id = $1',
    [userId],
  );

  if (tokens.length === 0) return;

  const tokenStrings = tokens.map((t) => t.token);
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenStrings,
      notification: { title, body },
      data: data ?? {},
      webpush: {
        fcmOptions: { link: `${config.frontendUrl}/lobby` },
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
  } catch (err) {
    console.error('[Notifications] Push send failed:', err);
  }
}

// ── Email Notifications ──────────────────────────────────────────────────────

export async function sendEmailNotification(
  userId: string,
  subject: string,
  htmlBody: string,
): Promise<void> {
  const transporter = getSmtpTransporter();
  if (!transporter) return;

  const user = await queryOne<{ email: string | null }>(
    'SELECT email FROM users WHERE user_id = $1',
    [userId],
  );
  if (!user?.email) return;

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: user.email,
      subject,
      html: htmlBody,
    });
  } catch (err) {
    console.error('[Notifications] Email send failed:', err);
  }
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

  const eraLabel = ERA_LABELS[gameState.era] ?? 'Eras of Empire';
  const deadlineSec = gameState.settings.async_turn_deadline_seconds ?? 86400;
  const deadlineHours = Math.round(deadlineSec / 3600);
  const deadlineLabel = deadlineHours >= 24
    ? `${Math.round(deadlineHours / 24)} day${deadlineHours >= 48 ? 's' : ''}`
    : `${deadlineHours} hours`;

  const title = "It's your turn!";
  const body = `${eraLabel} — Turn ${gameState.turn_number}. You have ${deadlineLabel} to play.`;
  const gameUrl = `${config.frontendUrl}/game/${gameId}`;

  // Send push notification
  if (pushEnabled) {
    await sendPushNotification(currentPlayerId, title, body, { gameId, url: gameUrl });
  }

  // Send email notification
  if (emailEnabled) {
    const htmlBody = `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #d4a843;">It's Your Turn!</h2>
        <p><strong>${eraLabel}</strong> — Turn ${gameState.turn_number}</p>
        <p>You have <strong>${deadlineLabel}</strong> to make your move.</p>
        <a href="${gameUrl}"
           style="display: inline-block; padding: 12px 24px; background: #d4a843; color: #0f1117;
                  text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 12px;">
          Play Now
        </a>
        <p style="margin-top: 24px; font-size: 12px; color: #888;">
          You can disable email notifications in your <a href="${config.frontendUrl}/profile">profile settings</a>.
        </p>
      </div>
    `;
    await sendEmailNotification(currentPlayerId, `${title} — ${eraLabel}`, htmlBody);
  }

  // Log notification
  const channel = [pushEnabled && 'push', emailEnabled && 'email'].filter(Boolean).join(',') || 'none';
  await query(
    `INSERT INTO async_notifications (game_id, user_id, type, channel, delivery_status)
     VALUES ($1, $2, 'your_turn', $3, 'sent')`,
    [gameId, currentPlayerId, channel],
  );
}

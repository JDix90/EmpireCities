// ── One-click email unsubscribe tokens ──────────────────────────────────────
// Stateless HMAC tokens embedded in every re-engagement email so recipients
// can opt out without logging in. Deliberately NOT time-limited: the action
// is idempotent (flip email_notifications off) and an unsubscribe link that
// has expired is a spam complaint waiting to happen.

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

function secret(): string {
  return process.env.UNSUBSCRIBE_TOKEN_SECRET || config.jwt.accessSecret;
}

function hmac(userId: string): Buffer {
  return createHmac('sha256', secret()).update(userId).digest();
}

/** Token format: base64url(userId) + '.' + base64url(HMAC-SHA256(userId)). */
export function signUnsubscribeToken(userId: string): string {
  const payload = Buffer.from(userId, 'utf8').toString('base64url');
  const sig = hmac(userId).toString('base64url');
  return `${payload}.${sig}`;
}

/** Returns the userId for a valid token, or null. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  let userId: string;
  let providedSig: Buffer;
  try {
    userId = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    providedSig = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  if (!userId) return null;
  const expectedSig = hmac(userId);
  if (providedSig.length !== expectedSig.length) return null;
  return timingSafeEqual(providedSig, expectedSig) ? userId : null;
}

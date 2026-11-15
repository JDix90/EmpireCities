/**
 * A code the player can type instead of following the emailed sign-in link
 * (`sign_in_code_enabled`).
 *
 * The link signs in whichever browser opens it. For the native app that is the
 * wrong place more often than not: a mail app opens the link in its own
 * browser, or wraps it in a tracking redirect, and neither hands it to the
 * app. The same email therefore also carries a short code, which the player
 * types into the app next to the address the email was sent to.
 *
 * A code is a second way to spend the SAME one-time sign-in link row: the link
 * and the code are used up together, expire together, and a new request
 * replaces both. Redis holds only `hash(email, code) → link row id`, for as
 * long as the link lives; no code is stored in the clear.
 *
 * It is far shorter than the link's token, so it is guarded differently: it is
 * only good together with the email address, and an address gets a limited
 * number of tries per half hour, right or wrong.
 */
import { createHash, randomInt } from 'crypto';
import { redis } from '../../db/redis';

/** No I, L, O, 0 or 1: nothing that reads as something else in an email. */
export const SIGN_IN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SIGN_IN_CODE_LENGTH = 8;
/** Tries per address per window, right or wrong. 31^8 codes: ten guesses find nothing. */
export const SIGN_IN_CODE_MAX_TRIES = 10;
export const SIGN_IN_CODE_TRY_WINDOW_SECONDS = 30 * 60;

export function generateSignInCode(): string {
  let code = '';
  for (let i = 0; i < SIGN_IN_CODE_LENGTH; i += 1) {
    code += SIGN_IN_CODE_ALPHABET[randomInt(SIGN_IN_CODE_ALPHABET.length)];
  }
  return code;
}

/** As the email shows it: `ABCD-EFGH`. */
export function formatSignInCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What the player typed, as a code: case, spaces and the hyphen do not matter.
 * Null when it cannot be one, which costs no lookup.
 */
export function normalizeSignInCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== SIGN_IN_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!SIGN_IN_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

/** The address as a key: what the request and the code entry must agree on. */
export function signInCodeEmailKey(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const codeKey = (email: string, code: string) => `signin-code:${sha(`${signInCodeEmailKey(email)}\n${code}`)}`;
const triesKey = (email: string) => `signin-code-tries:${sha(signInCodeEmailKey(email))}`;

/** Remember that this code, for this address, spends that sign-in link row. */
export async function rememberSignInCode(email: string, code: string, linkId: string, ttlMs: number): Promise<void> {
  await redis.set(codeKey(email, code), linkId, 'PX', ttlMs);
}

export type SignInCodeResult =
  | { status: 'ok'; linkId: string }
  /** Not a code for this address (or one already used, replaced or expired). */
  | { status: 'wrong' }
  /** Too many tries for this address: nothing is looked up until the window passes. */
  | { status: 'locked' };

/**
 * Spend a code. Every call counts as a try for the address, so the limit
 * cannot be probed for free, and a code is deleted as it is read: it works once.
 */
export async function redeemSignInCode(email: string, code: string): Promise<SignInCodeResult> {
  const tries = await redis.incr(triesKey(email));
  if (tries === 1) await redis.expire(triesKey(email), SIGN_IN_CODE_TRY_WINDOW_SECONDS);
  if (tries > SIGN_IN_CODE_MAX_TRIES) return { status: 'locked' };
  const key = codeKey(email, code);
  const linkId = await redis.get(key);
  if (!linkId) return { status: 'wrong' };
  await redis.del(key);
  return { status: 'ok', linkId };
}

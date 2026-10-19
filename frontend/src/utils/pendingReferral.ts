import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

/**
 * Referral links (`?ref=CODE`, made by the Refer a Friend panel) applying
 * their code (`player_links_play_enabled`).
 *
 * The code can only be redeemed by an account (`POST
 * /api/progression/referral/redeem` refuses guests), and most visitors start as
 * one. So the code is kept from the visit that carried it, and redeemed right
 * after the visitor registers or saves their guest account (store/authStore.ts
 * `register` and `upgradeAccount`). Signing in to an account that already
 * existed never redeems it: the link was for a new player.
 */

const STORAGE_KEY = 'cc-pending-referral';
/** A code older than this is dropped: the visit it came from is long past. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** The server's codes: 8 characters of an uppercase alphabet; it accepts up to 16. */
const CODE_RE = /^[A-Z0-9]{4,16}$/;

interface PendingReferral {
  code: string;
  at: number;
}

function sanitizeCode(raw: string | null): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The kept code, if it is well formed and recent enough. */
export function getPendingReferral(now: number = Date.now()): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PendingReferral> | null;
    const code = sanitizeCode(typeof parsed?.code === 'string' ? parsed.code : null);
    if (!code || typeof parsed?.at !== 'number' || now - parsed.at > MAX_AGE_MS || parsed.at > now) return null;
    return code;
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Run once at app boot (main.tsx). Keeps the first referral code a visit
 * carries, as first-touch attribution does: a second friend's link does not
 * take the credit from the first.
 */
export function capturePendingReferral(now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    const code = sanitizeCode(new URLSearchParams(window.location.search).get('ref'));
    if (!code || getPendingReferral(now)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, at: now } satisfies PendingReferral));
  } catch {
    /* storage unavailable: the link simply does not apply */
  }
}

let redeeming = false;

/**
 * Redeem the kept code for the account just made or saved. Never throws.
 * A code the server refuses (unknown, your own, or a referral already used) is
 * dropped; one that failed for any other reason is kept for the next account
 * change.
 */
export async function redeemPendingReferral(): Promise<void> {
  if (redeeming || !useFeatureFlagsStore.getState().flags.player_links_play_enabled) return;
  const code = getPendingReferral();
  if (!code) return;
  redeeming = true;
  try {
    await api.post('/progression/referral/redeem', { code });
    clearPendingReferral();
    toast.success('Your friend’s invite is applied: you got 25 gold.');
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 400) clearPendingReferral();
  } finally {
    redeeming = false;
  }
}

/** Test seam. */
export function resetPendingReferralForTests(): void {
  redeeming = false;
}

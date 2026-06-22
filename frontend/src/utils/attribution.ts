/**
 * First-touch acquisition attribution (first-party only — no third-party SDK, no
 * extra cookies). On the first landing visit we snapshot the campaign params and
 * external referrer and persist them once to localStorage; the auth store then
 * attaches them to the first account-creating call (guest / register / upgrade),
 * where the backend folds them into the analytics signup event (see
 * backend/src/modules/auth/attribution.ts).
 *
 * "First-touch": once a snapshot with a real signal is stored we never overwrite
 * it, so a user who arrives via an ad and returns later directly is still
 * credited to the ad.
 */
const STORAGE_KEY = 'bf_attribution';
const MAX_LEN = 200;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export type Attribution = Partial<
  Record<(typeof UTM_KEYS)[number] | 'referrer' | 'landing_path', string>
>;

function clamp(value: string): string {
  return value.slice(0, MAX_LEN);
}

/**
 * Run once at app boot (see main.tsx). Idempotent and best-effort: only the
 * first visit that carries a real signal (a utm_* param or an external referrer)
 * is persisted; storage failures (private mode) are swallowed.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(STORAGE_KEY)) return; // first-touch already recorded
    const params = new URLSearchParams(window.location.search);
    const attribution: Attribution = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) attribution[key] = clamp(value);
    }

    // Store only the referrer host (avoid full URLs / query strings / PII), and
    // only when it's an EXTERNAL site — internal navigations aren't a signal.
    let externalReferrer = false;
    if (document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        if (host && host !== window.location.hostname) {
          attribution.referrer = clamp(host);
          externalReferrer = true;
        }
      } catch {
        /* opaque referrer — ignore */
      }
    }

    const hasUtm = UTM_KEYS.some((key) => attribution[key]);
    if (!hasUtm && !externalReferrer) return; // organic/direct — nothing to attribute

    attribution.landing_path = clamp(window.location.pathname);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    /* storage unavailable — attribution is best-effort, never block boot */
  }
}

/**
 * Stored first-touch attribution to attach to an auth request body, or undefined
 * if the visit was organic/direct (or storage is unavailable).
 */
export function getAttribution(): Attribution | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Attribution) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * IndexNow — push URLs to Bing (and the other participating engines) instead of
 * waiting to be crawled.
 *
 * Why this exists: the Daily archive mints exactly one new permanent URL per
 * day, and the answer pages went live to a site with almost no crawl budget.
 * Sitemaps tell an engine a URL exists the next time it decides to look;
 * IndexNow tells it now. For a page whose whole value is being retrievable when
 * someone asks an assistant a question, "next time it looks" is the expensive
 * part.
 *
 * The key is public by design — the protocol requires it to be readable at
 * `https://<host>/<key>.txt`, which is how the engine proves the sender
 * controls the host. It still comes from the environment rather than source, so
 * rotating it is a config change and the sending host stays configurable.
 *
 * Every failure here is swallowed. This is a best-effort notification about
 * content that is already published and already in a sitemap; it must never
 * take down a request path or a scheduled sweep.
 */
/** api.indexnow.org fans out to every participating engine, Bing included. */
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The protocol's own cap per request. */
export const MAX_URLS_PER_REQUEST = 10_000;

export interface IndexNowConfig {
  key: string;
  host: string;
  keyLocation: string;
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * Resolve config from the environment. Returns null when unconfigured, which is
 * the normal state everywhere except production — callers treat null as "skip",
 * never as an error.
 */
export function getIndexNowConfig(env: NodeJS.ProcessEnv = process.env): IndexNowConfig | null {
  const key = (env.INDEXNOW_KEY ?? '').trim();
  if (!key) return null;
  // A key that is not a plain token cannot be served at <key>.txt, so a
  // malformed one is a config mistake worth refusing rather than sending.
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return null;

  const site = (env.PUBLIC_SITE_URL || 'https://borderfall.gg').replace(/\/+$/, '');
  let host: string;
  try {
    host = new URL(site).hostname;
  } catch {
    return null;
  }
  return { key, host, keyLocation: `${site}/${key}.txt` };
}

/**
 * Keep only URLs on the configured host. IndexNow rejects a whole batch if any
 * URL is off-host, so one stray absolute link would silently cost the rest.
 */
export function filterSubmittableUrls(urls: readonly string[], host: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    if (parsed.hostname !== host) continue;
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function buildPayload(urls: readonly string[], cfg: IndexNowConfig): IndexNowPayload | null {
  const urlList = filterSubmittableUrls(urls, cfg.host).slice(0, MAX_URLS_PER_REQUEST);
  if (urlList.length === 0) return null;
  return { host: cfg.host, key: cfg.key, keyLocation: cfg.keyLocation, urlList };
}

export interface SubmitResult {
  submitted: number;
  status: number | null;
  skipped: 'unconfigured' | 'no-urls' | null;
  error?: string;
}

/**
 * Submit URLs. Never throws.
 *
 * A 200 or 202 means accepted. 400/403/422 mean the key or host is wrong and
 * retrying will not help, so they are logged once and dropped rather than
 * queued — a stuck retry loop against a third party is worse than a missed
 * ping for a page the sitemap already lists.
 */
export async function submitUrls(
  urls: readonly string[],
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<SubmitResult> {
  const cfg = getIndexNowConfig(opts.env ?? process.env);
  if (!cfg) return { submitted: 0, status: null, skipped: 'unconfigured' };

  const payload = buildPayload(urls, cfg);
  if (!payload) return { submitted: 0, status: null, skipped: 'no-urls' };

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status >= 400) {
      console.warn(`[indexnow] rejected ${payload.urlList.length} URL(s): HTTP ${res.status}`);
    } else {
      console.log(`[indexnow] submitted ${payload.urlList.length} URL(s): HTTP ${res.status}`);
    }
    return { submitted: payload.urlList.length, status: res.status, skipped: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[indexnow] submit failed: ${error}`);
    return { submitted: 0, status: null, skipped: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Public URL for one settled Daily archive day. */
export function dailyArchiveUrl(date: string, env: NodeJS.ProcessEnv = process.env): string {
  const site = (env.PUBLIC_SITE_URL || 'https://borderfall.gg').replace(/\/+$/, '');
  return `${site}/daily/${date}`;
}

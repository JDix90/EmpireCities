/**
 * Push to the iOS app, sent straight to Apple's push service (APNs).
 *
 * The website's push goes through Firebase (notificationService.ts). The iOS
 * app could too, but only by linking Firebase's SDK into the app and shipping
 * its config file in the bundle: more code in the app, more to declare on the
 * App Store's privacy label, and a build that cannot be made from this public
 * repository without a file that must not be in it. Without that SDK the token
 * iOS gives the app is an APNs token, which Firebase cannot send to. So for
 * `platform = 'ios'` tokens the server speaks APNs itself: HTTP/2, with a
 * short-lived token signed by the `.p8` key from the Apple Developer account.
 *
 * Nothing here is used unless APNS_KEY_PATH, APNS_KEY_ID and APNS_TEAM_ID are
 * all set.
 */
import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'crypto';
import { readFileSync } from 'fs';
import http2 from 'http2';
import { config } from '../config';

export const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
export const APNS_SANDBOX_ORIGIN = 'https://api.sandbox.push.apple.com';

/** Apple accepts a provider token for an hour and refuses one refreshed more than once in 20 minutes. */
const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsSenderOptions {
  /** The `.p8` key's contents (PEM, PKCS#8, P-256). */
  keyPem: string;
  /** The key's ten-character Key ID. */
  keyId: string;
  /** The Apple Developer Team ID. */
  teamId: string;
  /** The app's bundle ID: the topic a notification is addressed to. */
  bundleId: string;
  productionOrigin?: string;
  sandboxOrigin?: string;
  now?: () => number;
}

export interface ApnsNotification {
  title: string;
  body: string;
  /** Extra keys for the app (`gameId`, `type`, `url`), delivered beside `aps`. */
  data?: Record<string, string>;
  /** Replaces an earlier notification with the same id on the lock screen. */
  collapseId?: string;
}

export type ApnsResult =
  /** Apple took it. */
  | { status: 'sent'; environment: 'production' | 'sandbox' }
  /** The token is dead (app removed, or never a token): delete it. */
  | { status: 'gone'; reason: string }
  /** Not delivered, but the token may be fine: keep it. */
  | { status: 'failed'; reason: string };

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * The provider token Apple authenticates a request with: a JWT signed ES256
 * with the `.p8` key. `ieee-p1363` is the raw r||s signature JWS wants; Node's
 * default (DER) is refused by Apple as an invalid token.
 */
export function buildApnsProviderToken(key: KeyObject | string, keyId: string, teamId: string, issuedAtSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: issuedAtSeconds }));
  const signature = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), {
    key: typeof key === 'string' ? createPrivateKey(key) : key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${b64url(signature)}`;
}

/** An APNs device token is hex. Anything else was never one. */
export function isApnsDeviceToken(token: string): boolean {
  return /^[0-9a-fA-F]{64,200}$/.test(token);
}

/** The JSON Apple delivers to the device. The app's own keys sit beside `aps`. */
export function buildApnsPayload(n: ApnsNotification): Record<string, unknown> {
  return {
    ...(n.data ?? {}),
    aps: {
      alert: { title: n.title, body: n.body },
      sound: 'default',
      ...(n.collapseId ? { 'thread-id': n.collapseId } : {}),
    },
  };
}

export interface ApnsSender {
  send: (deviceToken: string, notification: ApnsNotification) => Promise<ApnsResult>;
  close: () => void;
}

export function createApnsSender(options: ApnsSenderOptions): ApnsSender {
  const key = createPrivateKey(options.keyPem);
  const now = options.now ?? Date.now;
  const origins = {
    production: options.productionOrigin ?? APNS_PRODUCTION_ORIGIN,
    sandbox: options.sandboxOrigin ?? APNS_SANDBOX_ORIGIN,
  };
  const sessions = new Map<string, http2.ClientHttp2Session>();
  /**
   * Tokens found to belong to the sandbox: a build run from Xcode gets one,
   * a TestFlight or App Store build gets a production one, and nothing in the
   * token says which. Remembered so the second send skips the wrong host.
   */
  const sandboxTokens = new Set<string>();
  let providerToken: { value: string; issuedAt: number } | null = null;

  const token = (fresh = false): string => {
    const at = now();
    if (fresh || !providerToken || at - providerToken.issuedAt > PROVIDER_TOKEN_TTL_MS) {
      providerToken = { value: buildApnsProviderToken(key, options.keyId, options.teamId, Math.floor(at / 1000)), issuedAt: at };
    }
    return providerToken.value;
  };

  const session = (origin: string): http2.ClientHttp2Session => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const created = http2.connect(origin);
    // Apple closes idle connections; the next send opens a new one.
    const drop = () => { if (sessions.get(origin) === created) sessions.delete(origin); };
    created.on('error', drop);
    created.on('close', drop);
    created.on('goaway', drop);
    created.unref();
    sessions.set(origin, created);
    return created;
  };

  const post = (origin: string, deviceToken: string, n: ApnsNotification): Promise<{ status: number; reason: string }> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (status: number, reason: string) => { if (!settled) { settled = true; resolve({ status, reason }); } };
      let request: http2.ClientHttp2Stream;
      try {
        request = session(origin).request({
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          authorization: `bearer ${token()}`,
          'apns-topic': options.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          ...(n.collapseId ? { 'apns-collapse-id': n.collapseId.slice(0, 64) } : {}),
          'content-type': 'application/json',
        });
      } catch (err) {
        done(0, (err as Error).message);
        return;
      }
      let status = 0;
      let body = '';
      request.setEncoding('utf8');
      request.setTimeout(REQUEST_TIMEOUT_MS, () => { request.close(http2.constants.NGHTTP2_CANCEL); done(0, 'timeout'); });
      request.on('response', (headers) => { status = Number(headers[':status']) || 0; });
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        let reason = '';
        try { reason = body ? String((JSON.parse(body) as { reason?: unknown }).reason ?? '') : ''; } catch { /* not JSON */ }
        done(status, reason);
      });
      request.on('error', (err) => done(0, err.message));
      request.end(JSON.stringify(buildApnsPayload(n)));
    });

  const attempt = async (origin: string, deviceToken: string, n: ApnsNotification) => {
    let res = await post(origin, deviceToken, n);
    // Apple's clock and ours disagreeing about the provider token's age: sign a new one, once.
    if (res.status === 403 && res.reason === 'ExpiredProviderToken') {
      token(true);
      res = await post(origin, deviceToken, n);
    }
    return res;
  };

  const send = async (deviceToken: string, n: ApnsNotification): Promise<ApnsResult> => {
    if (!isApnsDeviceToken(deviceToken)) return { status: 'gone', reason: 'NotADeviceToken' };
    const first: 'production' | 'sandbox' = sandboxTokens.has(deviceToken) ? 'sandbox' : 'production';
    let environment = first;
    let res = await attempt(origins[first], deviceToken, n);
    // A token from the other environment reads as a bad token here. Ask the other one before giving up on it.
    if (res.status === 400 && res.reason === 'BadDeviceToken') {
      environment = first === 'production' ? 'sandbox' : 'production';
      res = await attempt(origins[environment], deviceToken, n);
    }
    if (res.status === 200) {
      if (environment === 'sandbox') sandboxTokens.add(deviceToken);
      else sandboxTokens.delete(deviceToken);
      return { status: 'sent', environment };
    }
    // 410: the app was removed. BadDeviceToken from both: not a token for this app anywhere.
    // DeviceTokenNotForTopic: a token for some other app.
    if (res.status === 410 || res.reason === 'Unregistered' || res.reason === 'BadDeviceToken' || res.reason === 'DeviceTokenNotForTopic') {
      sandboxTokens.delete(deviceToken);
      return { status: 'gone', reason: res.reason || String(res.status) };
    }
    return { status: 'failed', reason: res.reason || (res.status ? `HTTP ${res.status}` : 'unreachable') };
  };

  const close = () => {
    for (const s of sessions.values()) s.close();
    sessions.clear();
  };

  return { send, close };
}

// ── The server's own sender, from its config ────────────────────────────────

let defaultSender: ApnsSender | null = null;
let defaultSenderAttempted = false;

/** Whether APNs is configured at all: the key file, its Key ID and the Team ID. */
export function isApnsConfigured(): boolean {
  const apns = config.push.apns;
  return Boolean(apns.keyPath && apns.keyId && apns.teamId);
}

/** The sender for this server, or null when APNs is not configured or the key cannot be read. */
export function getApnsSender(): ApnsSender | null {
  if (defaultSenderAttempted) return defaultSender;
  defaultSenderAttempted = true;
  if (!isApnsConfigured()) {
    console.log('[Notifications] APNS_KEY_PATH / APNS_KEY_ID / APNS_TEAM_ID not all set; iOS push disabled');
    return null;
  }
  try {
    const apns = config.push.apns;
    defaultSender = createApnsSender({
      keyPem: readFileSync(apns.keyPath, 'utf-8'),
      keyId: apns.keyId,
      teamId: apns.teamId,
      bundleId: apns.bundleId,
    });
    console.log('[Notifications] APNs sender initialized');
  } catch (err) {
    console.error('[Notifications] Failed to init APNs sender:', (err as Error).message);
    defaultSender = null;
  }
  return defaultSender;
}

/** Test seam: forget the sender so the next call reads the config again. */
export function resetApnsSenderForTests(): void {
  defaultSender?.close();
  defaultSender = null;
  defaultSenderAttempted = false;
}

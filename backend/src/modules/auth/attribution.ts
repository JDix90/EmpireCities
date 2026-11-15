import { z } from 'zod';

/**
 * First-touch acquisition attribution sent by the web client on the auth request
 * body (see frontend/src/utils/attribution.ts). First-party only — these are the
 * campaign params / referrer the browser already had in the URL on the landing
 * visit, not a third-party tracking SDK. Every field is optional and
 * length-capped; anything else is dropped.
 *
 * The flattened result is folded into the `properties` of the `guest_created` /
 * `user_registered` / `guest_upgraded` analytics events so signups can be
 * attributed to a channel (see analyticsQueries.getAcquisitionBySource and
 * scripts/funnelReport.ts). Only effective once ANALYTICS_EVENTS_ENABLED=true.
 */
// Trim then truncate (rather than reject) so one oversized value can't drop the
// rest of the attribution; empty strings are filtered out in parseAttribution.
const capped = z.string().trim().transform((s) => s.slice(0, 200));

export const AttributionSchema = z
  .object({
    utm_source: capped,
    utm_medium: capped,
    utm_campaign: capped,
    utm_content: capped,
    utm_term: capped,
    referrer: capped,
    landing_path: capped,
  })
  .partial();

export type Attribution = z.infer<typeof AttributionSchema>;

/**
 * The anonymous visitor session id (see frontend/src/utils/anonSession.ts) rides
 * the same attribution payload and stitches pre-signup landing_viewed /
 * hero_play_clicked beacons to this signup in the visitor funnel. Validated
 * SEPARATELY from the UTM schema so a malformed id can never cost us the
 * campaign attribution (and vice versa).
 */
const AnonSessionIdSchema = z.string().uuid();

/**
 * The device class the signup happened on (frontend/src/utils/device.ts
 * `deviceClass`), so the activation and tutorial funnels can be read for phones
 * and desktops separately. A closed set, validated on its own for the same
 * reason as the session id: a bad value must not cost the campaign fields.
 */
export const SIGNUP_DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export type SignupDeviceClass = (typeof SIGNUP_DEVICE_CLASSES)[number];
const DeviceClassSchema = z.enum(SIGNUP_DEVICE_CLASSES);

/**
 * Where the client was running: the website, or the iOS or Android app
 * (frontend/src/utils/platform.ts `clientPlatform`). The device class cannot
 * tell the iOS app from Safari on the same phone: both are a `phone`. Validated
 * on its own, like the device. A signup that carries no platform came from the
 * website: nothing else existed before the value was sent, and a browser tab
 * still running an older build is on the web by definition (SIGNUP_PLATFORM_SQL).
 */
export const CLIENT_PLATFORMS = ['web', 'ios', 'android'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
const ClientPlatformSchema = z.enum(CLIENT_PLATFORMS);

/**
 * Pull the optional `attribution` object off an auth request body and flatten it
 * into an analytics payload. Never throws: a missing / malformed / oversized
 * body just yields `{}` (an un-attributed event), so wiring this into an auth
 * route can never slow down or break a signup.
 */
export function parseAttribution(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const raw = (body as Record<string, unknown>).attribution;
  const out: Record<string, string> = {};
  const parsed = AttributionSchema.safeParse(raw);
  if (parsed.success) {
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string' && value.length > 0) out[key] = value;
    }
  }
  if (raw && typeof raw === 'object') {
    const anon = AnonSessionIdSchema.safeParse((raw as Record<string, unknown>).anon_session_id);
    if (anon.success) out.anon_session_id = anon.data;
    const device = DeviceClassSchema.safeParse((raw as Record<string, unknown>).device);
    if (device.success) out.device = device.data;
    const platform = ClientPlatformSchema.safeParse((raw as Record<string, unknown>).platform);
    if (platform.success) out.platform = platform.data;
  }
  return out;
}

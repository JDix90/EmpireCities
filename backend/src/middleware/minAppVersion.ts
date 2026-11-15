import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getNativeAppConfig,
  NATIVE_APP_PLATFORMS,
  type NativeAppConfig,
  type NativeAppPlatform,
} from '../services/adminConfig';
import { isBelowMinimumVersion } from '../utils/appVersion';

/**
 * The minimum native app version.
 *
 * The iOS and Android apps bundle a copy of the frontend frozen at build time.
 * A browser tab on an old build is moved to the new one by a reload; an
 * installed app stays on its build until the player updates it, which can be
 * never. So the app says which build it is on every API request, and once an
 * operator sets a minimum (Admin → Config, `native_app`) an older build is
 * answered with 426 and nothing else. The app shows a blocking "update
 * required" screen with a link to the store (frontend
 * components/native/UpdateRequiredScreen.tsx).
 *
 * The website sends neither header and is never affected.
 */

/** Must match the names in frontend/src/services/nativeAppVersion.ts. */
export const APP_PLATFORM_HEADER = 'x-bf-platform';
export const APP_VERSION_HEADER = 'x-bf-app-version';

/** The body of the 426. `code` is what the app looks for. */
export interface UpdateRequiredBody {
  error: string;
  code: 'UPDATE_REQUIRED';
  platform: NativeAppPlatform;
  min_version: string;
  /** The store listing to open, or '' when none is configured yet. */
  store_url: string;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : undefined;
}

/** The platform a request says it comes from, or null for the website and anything unknown. */
export function nativePlatformOf(headers: FastifyRequest['headers']): NativeAppPlatform | null {
  const platform = headerValue(headers[APP_PLATFORM_HEADER])?.toLowerCase();
  return (NATIVE_APP_PLATFORMS as readonly string[]).includes(platform ?? '') ? (platform as NativeAppPlatform) : null;
}

/**
 * The refusal for this request, or null to serve it.
 *
 * Blocks only on a comparison that can be made: a native platform, a minimum
 * set for it, and a version that parses and is older. A request with no
 * version, or one the server cannot read, is served: turning away a build
 * because of a bug in how it reports itself would lock out players who have
 * nothing to update to.
 */
export function updateRequiredFor(
  headers: FastifyRequest['headers'],
  cfg: NativeAppConfig = getNativeAppConfig(),
): UpdateRequiredBody | null {
  const platform = nativePlatformOf(headers);
  if (!platform) return null;
  const minimum = cfg[`${platform}_min_version`];
  if (!isBelowMinimumVersion(headerValue(headers[APP_VERSION_HEADER]), minimum)) return null;
  return {
    error: 'This version of the app is no longer supported. Update it to keep playing.',
    code: 'UPDATE_REQUIRED',
    platform,
    min_version: minimum,
    store_url: cfg[`${platform}_store_url`] ?? '',
  };
}

/**
 * Global onRequest hook (registered in index.ts after CORS, so the app can
 * read the refusal). A CORS preflight carries no custom header values and
 * passes on its own.
 */
export async function rejectOutdatedApp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.method === 'OPTIONS') return;
  const refusal = updateRequiredFor(request.headers);
  if (refusal) {
    return reply.code(426).send(refusal);
  }
}

/**
 * `GET /api/app/version-check`: what the app asks at launch, before anything
 * else. An outdated build never reaches this handler (the hook above answers
 * 426); everyone else is told they are current, with the minimum for their
 * platform for the record.
 */
export function versionCheckBody(headers: FastifyRequest['headers']): {
  update_required: false;
  platform: NativeAppPlatform | 'web';
  min_version: string;
} {
  const platform = nativePlatformOf(headers);
  return {
    update_required: false,
    platform: platform ?? 'web',
    min_version: platform ? getNativeAppConfig()[`${platform}_min_version`] : '',
  };
}

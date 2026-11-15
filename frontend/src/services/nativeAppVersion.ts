import axios, { type AxiosInstance } from 'axios';
import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { getApiBaseUrl, REQUEST_TIMEOUT_MS } from '../config/env';

/**
 * The native app's side of the minimum-version gate (backend
 * middleware/minAppVersion.ts).
 *
 * The app bundles a copy of this frontend frozen when it was built, and keeps
 * it until the player updates. So it tells the server which build it is on
 * every API request, and when the server answers 426 `UPDATE_REQUIRED` the
 * app stops and shows components/native/UpdateRequiredScreen.tsx with a link
 * to the store.
 *
 * None of this runs on the website: it sends no headers and is never refused.
 */

/** Must match the names in backend/src/middleware/minAppVersion.ts. */
export const APP_PLATFORM_HEADER = 'x-bf-platform';
export const APP_VERSION_HEADER = 'x-bf-app-version';

export interface UpdateRequiredInfo {
  platform: string;
  /** The oldest version the server still serves, for the screen to name. */
  minVersion: string;
  /** The store listing, or '' when the server has none configured. */
  storeUrl: string;
}

interface UpdateRequiredState {
  required: UpdateRequiredInfo | null;
  setRequired: (info: UpdateRequiredInfo | null) => void;
}

/** Set once the server has refused this build. App.tsx shows the blocking screen while it is. */
export const useUpdateRequiredStore = create<UpdateRequiredState>((set) => ({
  required: null,
  setRequired: (required) => set({ required }),
}));

let headers: Record<string, string> = {};
let loading: Promise<void> | null = null;

/** The headers that name this build: empty on the website, and in the app until `loadNativeAppInfo` lands. */
export function nativeAppHeaders(): Record<string, string> {
  return headers;
}

/**
 * Ask the native shell which build this is (`App.getInfo()`), once. Never
 * rejects: a build that cannot say what it is sends no headers, and the server
 * serves a request it cannot place rather than lock the player out.
 */
export function loadNativeAppInfo(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (!loading) {
    loading = import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => {
        const version = typeof info?.version === 'string' ? info.version.trim() : '';
        if (version) {
          headers = { [APP_PLATFORM_HEADER]: Capacitor.getPlatform(), [APP_VERSION_HEADER]: version };
        }
      })
      .catch(() => {});
  }
  return loading;
}

/** If this response is the server's refusal of this build, record it. True when it was. */
export function noteUpdateRequired(status: number | undefined, data: unknown): boolean {
  if (status !== 426 || !data || typeof data !== 'object') return false;
  const body = data as { code?: unknown; platform?: unknown; min_version?: unknown; store_url?: unknown };
  if (body.code !== 'UPDATE_REQUIRED') return false;
  useUpdateRequiredStore.getState().setRequired({
    platform: typeof body.platform === 'string' ? body.platform : '',
    minVersion: typeof body.min_version === 'string' ? body.min_version : '',
    storeUrl: typeof body.store_url === 'string' ? body.store_url : '',
  });
  return true;
}

/**
 * Make an axios instance name this build on every request, and notice the
 * server's refusal on any response. Both API clients get this (services/api.ts
 * and the auth store's), so the refusal is caught wherever it first arrives.
 */
export function attachNativeAppVersion(instance: AxiosInstance): void {
  instance.interceptors.request.use((config) => {
    for (const [name, value] of Object.entries(headers)) config.headers.set(name, value);
    return config;
  });
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      noteUpdateRequired(error?.response?.status, error?.response?.data);
      return Promise.reject(error);
    },
  );
}

/** Its own client, so the launch check cannot be held up by a token refresh. */
const http = axios.create({ baseURL: getApiBaseUrl(), timeout: REQUEST_TIMEOUT_MS });
attachNativeAppVersion(http);

/**
 * The launch check: learn which build this is, then ask the server whether it
 * is still served. A refusal sets the store (through the interceptor); an
 * answer that this build is current clears it, which is how "Check again"
 * lets a player back in once the minimum is lowered. A network failure
 * changes nothing: a server that cannot be reached has refused no one.
 */
export async function checkNativeAppVersion(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await loadNativeAppInfo();
  try {
    await http.get('/app/version-check');
    useUpdateRequiredStore.getState().setRequired(null);
  } catch {
    /* refused (recorded by the interceptor) or unreachable (nothing to record) */
  }
}

/**
 * The link that opens the store app on its listing, not a web page about it:
 * `itms-apps://` for an App Store listing, `market://` for a Play one. The web
 * view hands a scheme that is not its own to the system, which opens the
 * store. Anything else is returned as it came.
 */
export function storeDeepLink(storeUrl: string): string {
  let url: URL;
  try {
    url = new URL(storeUrl);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (url.hostname === 'apps.apple.com' || url.hostname === 'itunes.apple.com') {
    return `itms-apps://${url.host}${url.pathname}${url.search}`;
  }
  if (url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && url.searchParams.get('id')) {
    return `market://details?id=${encodeURIComponent(url.searchParams.get('id') as string)}`;
  }
  return url.toString();
}

/** Test seam: forget the build and the refusal. */
export function resetNativeAppVersionForTests(): void {
  headers = {};
  loading = null;
  useUpdateRequiredStore.getState().setRequired(null);
}

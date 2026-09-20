// ============================================================
// Push Notification Service
// ============================================================
// Device registration for web (Firebase Cloud Messaging + service worker)
// and native (Capacitor) platforms, plus foreground display.
//
// Web push is OPT-IN. Nothing in this module asks for notification
// permission on its own: initPushNotifications() only completes a
// registration the player already granted, and enableWebPush() — the one
// function that prompts — is meant to be called from a click handler.
// ============================================================

import { Capacitor } from '@capacitor/core';
import type { MessagePayload } from 'firebase/messaging';
import toast from 'react-hot-toast';
import { api } from './api';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

export const FCM_SERVICE_WORKER_PATH = '/firebase-messaging-sw.js';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  /** Web Push certificate public key (Firebase console → Cloud Messaging). Optional: FCM has a default. */
  vapidKey: string;
}

/**
 * The `VITE_FIREBASE_*` values baked into this build, or null when the build
 * has no Firebase web app — the four the messaging SDK refuses to start
 * without are required; `authDomain` and the VAPID key are not.
 */
export function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const cfg: FirebaseWebConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '',
  };
  if (!cfg.apiKey || !cfg.projectId || !cfg.messagingSenderId || !cfg.appId) return null;
  return cfg;
}

/**
 * The service worker gets its Firebase config from its own URL.
 *
 * `public/` is copied verbatim by Vite, so no build step can inline the
 * values into the worker, and a worker cannot read `import.meta.env`. The
 * previous design had the worker read a `self.__FIREBASE_CONFIG__` global
 * that no code ever set: it booted with an empty config, `firebase.messaging()`
 * threw during install, and token registration could never complete. The
 * values are public identifiers that already ship in every page's bundle,
 * not secrets, so the query string is a fine place for them.
 */
export function buildServiceWorkerUrl(
  cfg: Pick<FirebaseWebConfig, 'apiKey' | 'authDomain' | 'projectId' | 'messagingSenderId' | 'appId'>,
): string {
  const params = new URLSearchParams({
    apiKey: cfg.apiKey,
    projectId: cfg.projectId,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
  if (cfg.authDomain) params.set('authDomain', cfg.authDomain);
  return `${FCM_SERVICE_WORKER_PATH}?${params.toString()}`;
}

export type WebPushStatus =
  /** The build carries no Firebase web app, so there is nothing to register with. */
  | 'unconfigured'
  /** No Notification or service-worker API here — e.g. Safari on iOS outside a Home Screen app. */
  | 'unsupported'
  /** Never asked. The only state in which enableWebPush() will prompt. */
  | 'default'
  | 'denied'
  | 'granted';

export function getWebPushStatus(): WebPushStatus {
  if (!readFirebaseWebConfig()) return 'unconfigured';
  // Test the VALUE, not the key: an iOS Safari tab (and a stubbed test) can
  // carry the property as undefined.
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * True in an iPhone/iPad browser tab. Web push there exists only inside a
 * Home Screen web app (iOS 16.4+), so the useful advice is "add to Home
 * Screen", not "enable notifications".
 */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
  return !standalone;
}

let initialized = false;

/**
 * Initialize push notifications. Call once after user authentication.
 * - Web: completes FCM registration if permission was already granted.
 * - Native (iOS/Android): uses @capacitor/push-notifications.
 */
export async function initPushNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    if (Capacitor.isNativePlatform()) {
      await initNativePush();
    } else {
      await initWebPush();
    }
  } catch (err) {
    console.error('[Push] Initialization failed:', err);
  }
}

// ── Web Push (Firebase Cloud Messaging) ──────────────────────────────────────

async function initWebPush(): Promise<void> {
  // Config first, permission second — and never a prompt from here.
  //
  // This used to call Notification.requestPermission() before checking whether
  // Firebase was configured at all, and did so from a login effect with no
  // user gesture. Browsers quiet or refuse a gesture-less prompt and then
  // REMEMBER the refusal for the origin. So every login on a deployment
  // without Firebase burned the one prompt the site gets, for nothing — and
  // those players cannot be asked again once push actually works without
  // digging through browser settings. The asking lives in enableWebPush(),
  // which runs inside a click.
  const status = getWebPushStatus();
  if (status === 'unconfigured') {
    console.log('[Push] Firebase config not set; skipping web push');
    return;
  }
  if (status === 'unsupported') {
    console.log('[Push] Browser does not support notifications');
    return;
  }
  if (status !== 'granted') {
    console.log(`[Push] Notification permission is '${status}'; not prompting from init`);
    return;
  }
  const cfg = readFirebaseWebConfig();
  if (cfg) await registerWebPush(cfg);
}

export type EnableWebPushResult = WebPushStatus | 'error';

/**
 * Ask for notification permission and register this browser with FCM.
 *
 * Call ONLY from a click handler. Browsers require a user gesture to show the
 * permission prompt, and the prompt is a one-shot per origin: a refusal is
 * remembered. `Notification.requestPermission()` is the first thing awaited,
 * before any dynamic import, so Safari's transient-activation window is still
 * open when it runs.
 *
 * Resolves to the resulting status; 'default' means the prompt was dismissed
 * without a choice (it can be asked again), 'error' means permission is
 * granted but registration failed (network, FCM, or the backend).
 */
export async function enableWebPush(): Promise<EnableWebPushResult> {
  const status = getWebPushStatus();
  if (status === 'unconfigured' || status === 'unsupported' || status === 'denied') return status;
  const cfg = readFirebaseWebConfig();
  if (!cfg) return 'unconfigured';

  const permission = status === 'granted' ? 'granted' : await Notification.requestPermission();
  if (status !== 'granted') {
    api
      .post('/analytics/ui-event', {
        event: permission === 'granted' ? 'push_optin_granted' : 'push_optin_refused',
        properties: { result: permission },
      })
      .catch(() => {});
  }
  if (permission !== 'granted') return permission;

  const ok = await registerWebPush(cfg);
  return ok ? 'granted' : 'error';
}

let webRegistration: Promise<boolean> | null = null;

/**
 * Register this browser with FCM and hand the token to the backend. Assumes
 * permission is 'granted'. Memoised per page load, so the login-time init and
 * a later opt-in click share one registration; a failure clears the memo so
 * the opt-in control can retry.
 */
function registerWebPush(cfg: FirebaseWebConfig): Promise<boolean> {
  if (!webRegistration) {
    webRegistration = doRegisterWebPush(cfg).catch((err) => {
      console.error('[Push] Web push setup failed:', err);
      webRegistration = null;
      return false;
    });
  }
  return webRegistration;
}

async function doRegisterWebPush(cfg: FirebaseWebConfig): Promise<boolean> {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getMessaging, getToken, onMessage } = await import('firebase/messaging');

  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
    });
  const messaging = getMessaging(app);

  // The worker reads its Firebase config from this URL — see buildServiceWorkerUrl.
  const swReg = await navigator.serviceWorker.register(buildServiceWorkerUrl(cfg));

  const token = await getToken(messaging, {
    vapidKey: cfg.vapidKey || undefined,
    serviceWorkerRegistration: swReg,
  });
  if (!token) return false;

  await api.post('/users/me/push-tokens', { token, platform: 'web' });
  console.log('[Push] Web push token registered');

  onMessage(messaging, handleForegroundMessage);
  return true;
}

/**
 * A push that arrives while the tab is in front. The FCM SDK shows nothing
 * itself in that case, so this is the only place it becomes visible — but the
 * app-wide socket listeners already surface these two events in-app, and a
 * second toast for the same turn is noise. While the tab is hidden the SDK
 * shows the system notification and this handler never runs.
 */
export function handleForegroundMessage(payload: MessagePayload): void {
  const type = payload.data?.type;
  const flags = useFeatureFlagsStore.getState().flags;
  if (type === 'match_found') return; // GlobalMatchNotifier owns it
  if (type === 'your_turn' && flags.async_turn_alerts_enabled) return; // GlobalTurnNotifier owns it
  const title = payload.notification?.title ?? "It's your turn!";
  const body = payload.notification?.body ?? '';
  toast(`${title}\n${body}`, { duration: 8000, icon: '🎮' });
}

// ── Native Push (Capacitor) ──────────────────────────────────────────────────

async function initNativePush(): Promise<void> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.log('[Push] Native push permission denied');
      return;
    }

    // Register with APNs / FCM
    await PushNotifications.register();

    // Handle successful registration
    PushNotifications.addListener('registration', async (tokenData) => {
      const platform = Capacitor.getPlatform() as 'ios' | 'android';
      try {
        await api.post('/users/me/push-tokens', {
          token: tokenData.value,
          platform,
        });
        console.log('[Push] Native push token registered');
      } catch (err) {
        console.error('[Push] Failed to register native token:', err);
      }
    });

    // Handle registration errors
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] Native registration failed:', err);
    });

    // Handle received notifications when app is in foreground
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      // Match-found is surfaced by the app-wide socket listener (see web path).
      if (notification.data?.type === 'match_found') return;
      toast(
        `${notification.title ?? "It's your turn!"}\n${notification.body ?? ''}`,
        { duration: 8000, icon: '🎮' },
      );
    });

    // Handle notification tap (open game)
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const gameId = action.notification.data?.gameId;
      if (gameId) {
        window.location.href = `/game/${gameId}`;
      }
    });
  } catch (err) {
    console.error('[Push] Native push setup failed:', err);
  }
}

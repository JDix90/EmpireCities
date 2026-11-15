// ============================================================
// Push Notification Service
// ============================================================
// Device registration for web (Firebase Cloud Messaging + service worker)
// and native (Capacitor) platforms, plus foreground display.
//
// Push is OPT-IN, on the web and in the native app alike. Nothing in this
// module asks for notification permission on its own: initPushNotifications()
// only completes a registration the player already granted, and
// enableWebPush() — the one function that prompts — is meant to be called
// from a click handler. In the native app the same two functions drive the
// system's own permission (see "Native Push" below), so every control built
// on them works there unchanged.
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
  // The native app: the system's permission for the app, as last checked. It
  // needs no Firebase web config; its token comes from the system.
  if (Capacitor.isNativePlatform()) return nativeStatus;
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
  // The native app is not a browser tab: there is nothing to add to the Home
  // Screen, and telling a player who installed the app to install it is wrong.
  if (Capacitor.isNativePlatform()) return false;
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
  // The native app runs this for every sign-in, not once per launch: the
  // device's token has to be registered to whoever is signed in now.
  if (Capacitor.isNativePlatform()) {
    await initNativePush();
    return;
  }
  if (initialized) return;
  initialized = true;

  try {
    await initWebPush();
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
  if (Capacitor.isNativePlatform()) return enableNativePush();
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
//
// The native app uses the system's push: on iOS the token is Apple's (APNs),
// which the server sends to directly (backend services/apnsService.ts). The
// rules are the web's: never ask at sign-in, ask only from a control the
// player pressed.

/**
 * The system's permission for the app, in the web's terms. 'unsupported'
 * until it has been checked, so no control offers anything on a guess.
 */
let nativeStatus: WebPushStatus = 'unsupported';
let nativeListeners: Promise<void> | null = null;
/** The token the system gave this run, to register to whoever signs in next. */
let nativeToken: string | null = null;
const statusListeners = new Set<() => void>();

/**
 * Be told when the push status changes without the control having asked: in
 * the native app it is learned after the first screen has drawn. Returns the
 * unsubscribe. On the website it never fires.
 */
export function subscribePushStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function setNativeStatus(next: WebPushStatus): void {
  if (next === nativeStatus) return;
  nativeStatus = next;
  for (const listener of statusListeners) listener();
}

function fromNativePermission(receive: string): WebPushStatus {
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'default';
}

/** Whether this is the native app: its notification copy names the device and the Settings app, not a browser. */
export function isNativePush(): boolean {
  return Capacitor.isNativePlatform();
}

/** What to tell a player whose notifications are blocked: where the switch is. */
export function pushBlockedMessage(): string {
  return isNativePush()
    ? 'Notifications are off for Borderfall. Turn them on in the Settings app, under Notifications.'
    : 'Notifications are blocked for this site in your browser settings';
}

async function postNativeToken(token: string): Promise<void> {
  try {
    await api.post('/users/me/push-tokens', {
      token,
      platform: Capacitor.getPlatform() as 'ios' | 'android',
    });
  } catch (err) {
    console.error('[Push] Failed to register native token:', err);
  }
}

/** Go to a route without reloading the app: the router follows the history. */
function openInApp(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Listeners first, once: a token that arrives before anyone listens is lost. */
function attachNativeListeners(): Promise<void> {
  if (!nativeListeners) {
    nativeListeners = (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.addListener('registration', (tokenData) => {
        nativeToken = tokenData.value;
        void postNativeToken(tokenData.value);
      });
      await PushNotifications.addListener('registrationError', (err) => {
        console.error('[Push] Native registration failed:', err);
      });
      // In front, the system shows nothing; this does. The same rules as the
      // web: what the app-wide socket listeners already announce is not said twice.
      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        handleForegroundMessage({
          data: notification.data,
          notification: { title: notification.title, body: notification.body },
        } as MessagePayload);
      });
      // A tap on the notification opens the game it is about, inside the app.
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const gameId = action.notification.data?.gameId;
        if (typeof gameId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(gameId)) {
          openInApp(`/game/${gameId}`);
        }
      });
    })().catch((err) => {
      nativeListeners = null;
      throw err;
    });
  }
  return nativeListeners;
}

/**
 * Runs at sign-in. Never prompts: it reads the permission the player has
 * already given or refused, and with it given registers the device to the
 * account now signed in.
 */
async function initNativePush(): Promise<void> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await attachNativeListeners();
    const permission = await PushNotifications.checkPermissions();
    setNativeStatus(fromNativePermission(permission.receive));
    if (nativeStatus !== 'granted') return;
    // A token already in hand belongs to this device, whoever is signed in.
    if (nativeToken) await postNativeToken(nativeToken);
    else await PushNotifications.register();
  } catch (err) {
    console.error('[Push] Native push setup failed:', err);
  }
}

/**
 * The native side of enableWebPush(): show the system's permission prompt and,
 * if the player allows, register the device. Call from a click, like the web's.
 * iOS shows its prompt once; after a refusal this resolves 'denied' without
 * one, and only the Settings app can change it.
 */
async function enableNativePush(): Promise<EnableWebPushResult> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await attachNativeListeners();
    const before = nativeStatus;
    const permission = await PushNotifications.requestPermissions();
    const status = fromNativePermission(permission.receive);
    setNativeStatus(status);
    if (before !== 'granted') {
      api
        .post('/analytics/ui-event', {
          event: status === 'granted' ? 'push_optin_granted' : 'push_optin_refused',
          properties: { result: status },
        })
        .catch(() => {});
    }
    if (status !== 'granted') return status;
    if (nativeToken) await postNativeToken(nativeToken);
    else await PushNotifications.register();
    return 'granted';
  } catch (err) {
    console.error('[Push] Native push opt-in failed:', err);
    return 'error';
  }
}

/** Test seam: forget what the native side has learned. */
export function resetNativePushForTests(): void {
  nativeStatus = 'unsupported';
  nativeListeners = null;
  nativeToken = null;
  statusListeners.clear();
}

/**
 * Web push: never prompts on its own, prompts only from enableWebPush(), and
 * hands the service worker its config through the registration URL.
 *
 * Init used to call Notification.requestPermission() from the login effect —
 * no user gesture — and before checking whether Firebase was configured at
 * all. Browsers quiet or refuse a gesture-less prompt and remember the refusal
 * for the origin, so on a deployment without Firebase every login spent the
 * site's one prompt for nothing, and those players cannot be asked again once
 * push works. Separately, the worker was registered at a bare URL and read a
 * global nothing set, so it booted with an empty config. The contract pinned
 * here: init never prompts; enableWebPush() prompts exactly once, inside the
 * caller's gesture, and completes registration; the worker URL carries the
 * config; and the foreground handler stays out of the socket listeners' way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));
const apiPost = vi.fn();
vi.mock('./api', () => ({ api: { post: (...args: unknown[]) => apiPost(...args), get: vi.fn() } }));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: toastMock }));
const getTokenMock = vi.fn();
const onMessageMock = vi.fn();
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), getApps: () => [] }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: (...args: unknown[]) => getTokenMock(...args),
  onMessage: (...args: unknown[]) => onMessageMock(...args),
}));

const requestPermission = vi.fn();
const swRegister = vi.fn();

function stubBrowser(permission: NotificationPermission) {
  vi.stubGlobal('Notification', { permission, requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: swRegister },
    configurable: true,
  });
}

function stubFirebaseEnv(configured: boolean) {
  vi.stubEnv('VITE_FIREBASE_API_KEY', configured ? 'key' : '');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', configured ? 'proj' : '');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', configured ? 'proj.firebaseapp.com' : '');
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', configured ? '1' : '');
  vi.stubEnv('VITE_FIREBASE_APP_ID', configured ? 'app' : '');
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', configured ? 'vapid' : '');
}

const EXPECTED_SW_URL =
  '/firebase-messaging-sw.js?apiKey=key&projectId=proj&messagingSenderId=1&appId=app&authDomain=proj.firebaseapp.com';

/** The module keeps per-page-load latches, so each case needs a fresh copy. */
async function fresh() {
  vi.resetModules();
  return import('./pushNotifications');
}

beforeEach(() => {
  apiPost.mockReset().mockResolvedValue({ data: { ok: true } });
  getTokenMock.mockReset().mockResolvedValue('tok-1');
  onMessageMock.mockReset();
  requestPermission.mockReset().mockResolvedValue('granted');
  swRegister.mockReset().mockResolvedValue({});
  toastMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('initPushNotifications (web)', () => {
  it('never prompts when Firebase is not configured — the prompt was being spent for nothing', async () => {
    stubFirebaseEnv(false);
    stubBrowser('default');
    await (await fresh()).initPushNotifications();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('never prompts from init even with Firebase configured — a prompt needs a gesture', async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    await (await fresh()).initPushNotifications();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('does not touch a permission the player already refused', async () => {
    stubFirebaseEnv(true);
    stubBrowser('denied');
    await (await fresh()).initPushNotifications();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('completes registration when permission was already granted, with the config in the worker URL', async () => {
    stubFirebaseEnv(true);
    stubBrowser('granted');
    await (await fresh()).initPushNotifications();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(swRegister).toHaveBeenCalledWith(EXPECTED_SW_URL);
    expect(getTokenMock).toHaveBeenCalledWith({}, { vapidKey: 'vapid', serviceWorkerRegistration: {} });
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: 'tok-1', platform: 'web' });
  });
});

describe('buildServiceWorkerUrl', () => {
  it('encodes the config into the query string and leaves authDomain out when empty', async () => {
    const { buildServiceWorkerUrl } = await fresh();
    expect(
      buildServiceWorkerUrl({ apiKey: 'a b', authDomain: '', projectId: 'p', messagingSenderId: '9', appId: '1:9:web:x' }),
    ).toBe('/firebase-messaging-sw.js?apiKey=a+b&projectId=p&messagingSenderId=9&appId=1%3A9%3Aweb%3Ax');
  });
});

describe('getWebPushStatus', () => {
  it('reports unconfigured before anything else — a build without Firebase shows no push UI at all', async () => {
    stubFirebaseEnv(false);
    vi.stubGlobal('Notification', undefined);
    expect((await fresh()).getWebPushStatus()).toBe('unconfigured');
  });

  it('reports unsupported when the browser has no Notification API (Safari on iOS outside a Home Screen app)', async () => {
    stubFirebaseEnv(true);
    vi.stubGlobal('Notification', undefined);
    expect((await fresh()).getWebPushStatus()).toBe('unsupported');
  });

  it('passes the permission through otherwise', async () => {
    stubFirebaseEnv(true);
    for (const p of ['default', 'denied', 'granted'] as const) {
      stubBrowser(p);
      expect((await fresh()).getWebPushStatus()).toBe(p);
    }
  });
});

describe('enableWebPush — the one place that prompts', () => {
  it('prompts, registers and reports granted when the player allows', async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    const { enableWebPush } = await fresh();
    await expect(enableWebPush()).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(swRegister).toHaveBeenCalledWith(EXPECTED_SW_URL);
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: 'tok-1', platform: 'web' });
    expect(apiPost).toHaveBeenCalledWith('/analytics/ui-event', {
      event: 'push_optin_granted',
      properties: { result: 'granted' },
    });
  });

  it('reports denied and registers nothing when the player refuses', async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    requestPermission.mockResolvedValue('denied');
    const { enableWebPush } = await fresh();
    await expect(enableWebPush()).resolves.toBe('denied');
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalledWith('/users/me/push-tokens', expect.anything());
    expect(apiPost).toHaveBeenCalledWith('/analytics/ui-event', {
      event: 'push_optin_refused',
      properties: { result: 'denied' },
    });
  });

  it("reports default when the prompt was dismissed without a choice — it can be asked again", async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    requestPermission.mockResolvedValue('default');
    const { enableWebPush } = await fresh();
    await expect(enableWebPush()).resolves.toBe('default');
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('never re-prompts a player who already refused, and never prompts on an unconfigured build', async () => {
    stubFirebaseEnv(true);
    stubBrowser('denied');
    await expect((await fresh()).enableWebPush()).resolves.toBe('denied');
    stubFirebaseEnv(false);
    stubBrowser('default');
    await expect((await fresh()).enableWebPush()).resolves.toBe('unconfigured');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('registers without prompting when permission is already granted', async () => {
    stubFirebaseEnv(true);
    stubBrowser('granted');
    const { enableWebPush } = await fresh();
    await expect(enableWebPush()).resolves.toBe('granted');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: 'tok-1', platform: 'web' });
  });

  it('reports error when registration fails after a grant, and lets the next click retry', async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    getTokenMock.mockRejectedValueOnce(new Error('fcm down'));
    const { enableWebPush } = await fresh();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(enableWebPush()).resolves.toBe('error');
    quiet.mockRestore();
    stubBrowser('granted'); // the browser remembers the grant
    await expect(enableWebPush()).resolves.toBe('granted');
    expect(getTokenMock).toHaveBeenCalledTimes(2);
  });

  it('shares one registration between init and a later opt-in click', async () => {
    stubFirebaseEnv(true);
    stubBrowser('granted');
    const mod = await fresh();
    await mod.initPushNotifications();
    await mod.enableWebPush();
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleForegroundMessage', () => {
  async function withFlags(asyncTurnAlerts: boolean) {
    const mod = await fresh();
    const { useFeatureFlagsStore } = await import('../store/featureFlagsStore');
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, async_turn_alerts_enabled: asyncTurnAlerts } }));
    return mod.handleForegroundMessage;
  }

  it('stays quiet for a turn push while the in-app socket alert owns it', async () => {
    const handle = await withFlags(true);
    handle({ data: { type: 'your_turn', gameId: 'g1' }, notification: { title: 'T', body: 'B' } } as never);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('toasts a turn push when the in-app alert is switched off — then it is the only channel', async () => {
    const handle = await withFlags(false);
    handle({ data: { type: 'your_turn', gameId: 'g1' }, notification: { title: 'T', body: 'B' } } as never);
    expect(toastMock).toHaveBeenCalledWith('T\nB', expect.objectContaining({ duration: 8000 }));
  });

  it('never toasts match-found (GlobalMatchNotifier owns it) and always toasts a test push', async () => {
    const handle = await withFlags(true);
    handle({ data: { type: 'match_found', gameId: 'g1' } } as never);
    expect(toastMock).not.toHaveBeenCalled();
    handle({ data: { type: 'test' }, notification: { title: 'Test', body: 'Working' } } as never);
    expect(toastMock).toHaveBeenCalledWith('Test\nWorking', expect.anything());
  });
});

describe('needsHomeScreenInstall', () => {
  function ua(value: string, standalone?: boolean) {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
  }

  it('is true in an iPhone browser tab and false once the app runs from the Home Screen', async () => {
    const { needsHomeScreenInstall } = await fresh();
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    expect(needsHomeScreenInstall()).toBe(true);
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', true);
    expect(needsHomeScreenInstall()).toBe(false);
  });

  it('is false on a desktop or Android browser', async () => {
    const { needsHomeScreenInstall } = await fresh();
    ua('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36');
    expect(needsHomeScreenInstall()).toBe(false);
  });
});

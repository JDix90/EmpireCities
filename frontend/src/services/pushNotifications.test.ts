/**
 * Web push init must never ask for notification permission on its own.
 *
 * It used to call Notification.requestPermission() from the login effect —
 * no user gesture — and before checking whether Firebase was configured at
 * all. Browsers quiet or refuse a gesture-less prompt and remember the refusal
 * for the origin, so on a deployment without Firebase every login spent the
 * site's one prompt for nothing, and those players cannot be asked again once
 * push works. The contract pinned here: init never prompts; with no Firebase
 * config it stops before even looking at permission; with config and a
 * permission already granted it completes registration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
}));
const apiPost = vi.fn();
vi.mock('./api', () => ({ api: { post: (...args: unknown[]) => apiPost(...args) } }));
vi.mock('react-hot-toast', () => ({ default: vi.fn() }));
const getTokenMock = vi.fn();
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: (...args: unknown[]) => getTokenMock(...args),
  onMessage: vi.fn(),
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

/** The module keeps an `initialized` latch, so each case needs a fresh copy. */
async function init() {
  vi.resetModules();
  const { initPushNotifications } = await import('./pushNotifications');
  await initPushNotifications();
}

describe('initPushNotifications (web)', () => {
  beforeEach(() => {
    apiPost.mockReset().mockResolvedValue({ data: { ok: true } });
    getTokenMock.mockReset().mockResolvedValue('tok-1');
    requestPermission.mockReset().mockResolvedValue('granted');
    swRegister.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never prompts when Firebase is not configured — the prompt was being spent for nothing', async () => {
    stubFirebaseEnv(false);
    stubBrowser('default');
    await init();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('never prompts from init even with Firebase configured — a prompt needs a gesture', async () => {
    stubFirebaseEnv(true);
    stubBrowser('default');
    await init();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('does not touch a permission the player already refused', async () => {
    stubFirebaseEnv(true);
    stubBrowser('denied');
    await init();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('completes registration when permission was already granted', async () => {
    stubFirebaseEnv(true);
    stubBrowser('granted');
    await init();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(swRegister).toHaveBeenCalledWith('/firebase-messaging-sw.js');
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: 'tok-1', platform: 'web' });
  });
});

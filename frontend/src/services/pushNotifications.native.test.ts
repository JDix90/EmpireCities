/**
 * Push in the native app. It is opt-in there exactly as on the web: signing in
 * never raises the system's permission prompt, only a control the player
 * pressed does, and the same two functions the web controls call drive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
}));
const apiPost = vi.fn();
vi.mock('./api', () => ({ api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn() } }));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: toastMock }));

type Listener = (payload: never) => void;
const plugin = vi.hoisted(() => ({
  permission: 'prompt' as string,
  /** What the player answers when the system asks. */
  answer: 'granted' as string,
  listeners: new Map<string, Listener>(),
  calls: [] as string[],
  registerFails: false,
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: async (event: string, cb: Listener) => {
      plugin.calls.push(`addListener:${event}`);
      plugin.listeners.set(event, cb);
      return { remove: async () => {} };
    },
    checkPermissions: async () => {
      plugin.calls.push('checkPermissions');
      return { receive: plugin.permission };
    },
    requestPermissions: async () => {
      plugin.calls.push('requestPermissions');
      if (plugin.permission === 'prompt') plugin.permission = plugin.answer;
      return { receive: plugin.permission };
    },
    register: async () => {
      plugin.calls.push('register');
      if (plugin.registerFails) throw new Error('no entitlement');
    },
  },
}));

const DEVICE_TOKEN = 'a1b2c3d4'.repeat(8);
const emit = (event: string, payload: unknown) => plugin.listeners.get(event)?.(payload as never);
const flush = () => new Promise((r) => setTimeout(r, 0));

async function fresh() {
  vi.resetModules();
  return import('./pushNotifications');
}

beforeEach(() => {
  apiPost.mockReset().mockResolvedValue({ data: { ok: true } });
  toastMock.mockReset();
  plugin.permission = 'prompt';
  plugin.answer = 'granted';
  plugin.listeners.clear();
  plugin.calls = [];
  plugin.registerFails = false;
});

describe('signing in', () => {
  it('never raises the permission prompt, and registers nothing while the player has not been asked', async () => {
    const push = await fresh();
    await push.initPushNotifications();
    expect(plugin.calls).not.toContain('requestPermissions');
    expect(plugin.calls).not.toContain('register');
    expect(push.getWebPushStatus()).toBe('default');
  });

  it('registers the device when the player allowed notifications before', async () => {
    plugin.permission = 'granted';
    const push = await fresh();
    await push.initPushNotifications();
    expect(plugin.calls).not.toContain('requestPermissions');
    // The listener is in place before the token is asked for.
    expect(plugin.calls.indexOf('addListener:registration')).toBeLessThan(plugin.calls.indexOf('register'));
    emit('registration', { value: DEVICE_TOKEN });
    await flush();
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: DEVICE_TOKEN, platform: 'ios' });
    expect(push.getWebPushStatus()).toBe('granted');
  });

  it('leaves a player who refused alone', async () => {
    plugin.permission = 'denied';
    const push = await fresh();
    await push.initPushNotifications();
    expect(plugin.calls).not.toContain('requestPermissions');
    expect(plugin.calls).not.toContain('register');
    expect(push.getWebPushStatus()).toBe('denied');
  });

  it('registers the same device to the next account that signs in', async () => {
    plugin.permission = 'granted';
    const push = await fresh();
    await push.initPushNotifications();
    emit('registration', { value: DEVICE_TOKEN });
    await flush();
    apiPost.mockClear();
    // A second sign-in in the same run: the token is already in hand.
    await push.initPushNotifications();
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: DEVICE_TOKEN, platform: 'ios' });
    expect(plugin.calls.filter((c) => c === 'register')).toHaveLength(1);
    expect(plugin.calls.filter((c) => c === 'addListener:registration')).toHaveLength(1);
  });
});

describe('the status the controls read', () => {
  it('is "unsupported" until the app has checked, so nothing is offered on a guess', async () => {
    const push = await fresh();
    expect(push.getWebPushStatus()).toBe('unsupported');
    // And an installed app is never told to add itself to the Home Screen.
    expect(push.needsHomeScreenInstall()).toBe(false);
  });

  it('tells a control that drew early once it is known', async () => {
    const push = await fresh();
    const seen: string[] = [];
    const stop = push.subscribePushStatus(() => seen.push(push.getWebPushStatus()));
    await push.initPushNotifications();
    expect(seen).toEqual(['default']);
    stop();
    await push.enableWebPush();
    expect(seen).toEqual(['default']);
  });
});

describe('turning notifications on from a control', () => {
  it('asks the system, registers the device, and records the answer', async () => {
    const push = await fresh();
    await push.initPushNotifications();
    expect(await push.enableWebPush()).toBe('granted');
    expect(plugin.calls).toContain('requestPermissions');
    expect(plugin.calls).toContain('register');
    expect(apiPost).toHaveBeenCalledWith('/analytics/ui-event', { event: 'push_optin_granted', properties: { result: 'granted' } });
    emit('registration', { value: DEVICE_TOKEN });
    await flush();
    expect(apiPost).toHaveBeenCalledWith('/users/me/push-tokens', { token: DEVICE_TOKEN, platform: 'ios' });
    expect(push.getWebPushStatus()).toBe('granted');
  });

  it('reports a refusal, registers nothing, and says where the switch is', async () => {
    plugin.answer = 'denied';
    const push = await fresh();
    await push.initPushNotifications();
    expect(await push.enableWebPush()).toBe('denied');
    expect(plugin.calls).not.toContain('register');
    expect(apiPost).toHaveBeenCalledWith('/analytics/ui-event', { event: 'push_optin_refused', properties: { result: 'denied' } });
    expect(push.pushBlockedMessage()).toContain('Settings app');
    expect(push.getWebPushStatus()).toBe('denied');
  });

  it('says so when the device could not be registered', async () => {
    plugin.registerFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const push = await fresh();
    expect(await push.enableWebPush()).toBe('error');
  });
});

describe('a notification arriving', () => {
  async function ready() {
    plugin.permission = 'granted';
    const push = await fresh();
    await push.initPushNotifications();
    return push;
  }

  it('shows in the app when it is in front', async () => {
    await ready();
    emit('pushNotificationReceived', { title: 'Test notification', body: 'Push is working.', data: { type: 'test' } });
    expect(toastMock).toHaveBeenCalledWith('Test notification\nPush is working.', expect.anything());
  });

  it('does not repeat what the app already announces itself', async () => {
    await ready();
    emit('pushNotificationReceived', { title: 'Match found!', body: 'go', data: { type: 'match_found', gameId: 'g1' } });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('opens its game inside the app when tapped, without reloading', async () => {
    await ready();
    const popped: string[] = [];
    const onPop = () => popped.push(window.location.pathname);
    window.addEventListener('popstate', onPop);
    emit('pushNotificationActionPerformed', { notification: { data: { type: 'your_turn', gameId: '7f3c-11' } } });
    window.removeEventListener('popstate', onPop);
    expect(popped).toEqual(['/game/7f3c-11']);
    window.history.pushState({}, '', '/');
  });

  it('goes nowhere for a tap that names no game, or something that is not one', async () => {
    await ready();
    const popped: string[] = [];
    const onPop = () => popped.push(window.location.pathname);
    window.addEventListener('popstate', onPop);
    emit('pushNotificationActionPerformed', { notification: { data: { type: 'test' } } });
    emit('pushNotificationActionPerformed', { notification: { data: { gameId: '../admin' } } });
    emit('pushNotificationActionPerformed', { notification: { data: { gameId: 'https://evil.test' } } });
    window.removeEventListener('popstate', onPop);
    expect(popped).toEqual([]);
  });
});

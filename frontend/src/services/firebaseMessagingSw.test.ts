/**
 * public/firebase-messaging-sw.js is a plain script Vite copies verbatim, so
 * it is evaluated here in a tiny sandbox: `importScripts`, `firebase`, `self`
 * and `clients` are stubs. Two things are pinned because both fail silently
 * in production:
 *
 *  1. The worker takes its Firebase config from its own URL. The previous
 *     version read `self.__FIREBASE_CONFIG__`, which nothing ever set, so the
 *     worker booted with an empty config and messaging threw during install.
 *  2. onBackgroundMessage must NOT show a message that carries a
 *     `notification` block — the FCM SDK already displayed it, and the second
 *     showNotification made every turn arrive as two cards.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../public/firebase-messaging-sw.js'), 'utf-8');

type BackgroundHandler = (payload: { notification?: unknown; data?: Record<string, string> }) => unknown;

function boot(workerUrl: string) {
  let backgroundHandler: BackgroundHandler | null = null;
  const showNotification = vi.fn();
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { href: workerUrl },
    registration: { showNotification },
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
  };
  const firebase = {
    initializeApp: vi.fn(),
    messaging: vi.fn(() => ({
      onBackgroundMessage: (fn: BackgroundHandler) => {
        backgroundHandler = fn;
      },
    })),
  };
  const clients = { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => null) };
  const importScripts = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  new Function('self', 'importScripts', 'firebase', 'clients', source)(self, importScripts, firebase, clients);
  warn.mockRestore();
  return { firebase, showNotification, listeners, clients, background: () => backgroundHandler };
}

const CONFIGURED =
  'https://borderfall.test/firebase-messaging-sw.js?apiKey=k1&projectId=p1&messagingSenderId=123&appId=a1&authDomain=p1.firebaseapp.com';

describe('firebase-messaging-sw.js', () => {
  it('reads its Firebase config from the registration URL', () => {
    const { firebase } = boot(CONFIGURED);
    expect(firebase.initializeApp).toHaveBeenCalledWith({
      apiKey: 'k1',
      authDomain: 'p1.firebaseapp.com',
      projectId: 'p1',
      messagingSenderId: '123',
      appId: 'a1',
    });
    expect(firebase.messaging).toHaveBeenCalled();
  });

  it('installs without touching Firebase when the URL carries no config — never a throw on install', () => {
    const { firebase, listeners } = boot('https://borderfall.test/firebase-messaging-sw.js');
    expect(firebase.initializeApp).not.toHaveBeenCalled();
    expect(firebase.messaging).not.toHaveBeenCalled();
    // The click handler still exists for page-side notifications.
    expect(listeners.notificationclick).toBeTypeOf('function');
  });

  it('does not show a message the SDK already displayed (one with a notification block)', () => {
    const { showNotification, background } = boot(CONFIGURED);
    background()!({
      notification: { title: "It's your turn!", body: 'Ancient Era — Turn 4' },
      data: { type: 'your_turn', gameId: 'g1', url: 'https://borderfall.test/game/g1' },
    });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('shows a data-only message itself, tagged like the page-side notifier', () => {
    const { showNotification, background } = boot(CONFIGURED);
    background()!({ data: { gameId: 'g1', url: 'https://borderfall.test/game/g1' } });
    expect(showNotification).toHaveBeenCalledWith(
      "It's your turn!",
      expect.objectContaining({
        tag: 'turn-g1',
        icon: '/icons/icon-192.png',
        data: { gameId: 'g1', url: 'https://borderfall.test/game/g1' },
      }),
    );
  });

  it('tags a data-only match-found message match-<gameId>', () => {
    const { showNotification, background } = boot(CONFIGURED);
    background()!({ data: { type: 'match_found', gameId: 'g2' } });
    expect(showNotification).toHaveBeenCalledWith('Match found!', expect.objectContaining({ tag: 'match-g2' }));
  });

  it('opens the notification URL on click when no tab has it', async () => {
    const { listeners, clients } = boot(CONFIGURED);
    const close = vi.fn();
    let pending: Promise<unknown> | null = null;
    listeners.notificationclick({
      notification: { close, data: { url: '/game/g1' } },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
    expect(close).toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/game/g1');
  });
});

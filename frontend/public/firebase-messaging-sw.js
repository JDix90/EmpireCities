// Firebase Cloud Messaging Service Worker
// Handles background push notifications when the app is not in focus.

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config is injected at build time via env vars.
// For the service worker, we read from a query param or use defaults.
firebase.initializeApp({
  apiKey: self.__FIREBASE_CONFIG__?.apiKey || '',
  authDomain: self.__FIREBASE_CONFIG__?.authDomain || '',
  projectId: self.__FIREBASE_CONFIG__?.projectId || '',
  messagingSenderId: self.__FIREBASE_CONFIG__?.messagingSenderId || '',
  appId: self.__FIREBASE_CONFIG__?.appId || '',
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  const gameId = payload.data?.gameId;
  // Match-found pushes tag `match-<gameId>` so a page-side Notification with
  // the same tag (shown when the tab was merely hidden) replaces rather than
  // stacks; turn pushes keep their historical `turn-` tag and fallbacks.
  const isMatchFound = payload.data?.type === 'match_found';
  const title = payload.notification?.title || (isMatchFound ? 'Match found!' : "It's your turn!");
  const body =
    payload.notification?.body ||
    (isMatchFound ? 'Your ranked game has started.' : 'Your opponent has made their move.');

  self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { gameId, url: payload.data?.url || '/lobby' },
    tag: gameId ? `${isMatchFound ? 'match' : 'turn'}-${gameId}` : 'turn-notification',
    renotify: true,
  });
});

// Handle notification click — navigate to the game
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/lobby';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    }),
  );
});

// Firebase Cloud Messaging service worker — background push for the web app.
//
// CONFIG. The page registers this worker as
//   /firebase-messaging-sw.js?apiKey=…&projectId=…&messagingSenderId=…&appId=…
// (buildServiceWorkerUrl in src/services/pushNotifications.ts) and the config
// is read back from that URL below. Files in public/ are copied verbatim by
// Vite, so no build step can inline the values here, and a worker cannot read
// import.meta.env. The previous version read a `self.__FIREBASE_CONFIG__`
// global that no code ever set: it booted with an empty config, threw inside
// firebase.messaging() during install, and token registration could never
// complete. These values are public identifiers that ship in every page's
// bundle — not secrets.
//
// DISPLAY. A message that carries a `notification` block is shown by the FCM
// SDK itself while the tab is hidden; the backend shapes that card through
// `webpush.notification` (icon, tag) and `webpush.fcmOptions.link` (click
// target). onBackgroundMessage is ALSO invoked for that same message, so
// calling showNotification here as well produced TWO cards for one turn. The
// handler below therefore renders data-only messages only. Nothing sends one
// today; it exists so a future data-only message is shown rather than lost.

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

// PNG on purpose: Android's notification tray does not render the SVG favicon.
const ICON = '/icons/icon-192.png';

/** What to show for a data-only payload. Tags match the page-side notifiers so cards replace, not stack. */
function buildNotification(payload) {
  const data = payload.data || {};
  const gameId = data.gameId;
  const isMatchFound = data.type === 'match_found';
  return {
    title: isMatchFound ? 'Match found!' : "It's your turn!",
    options: {
      body: isMatchFound ? 'Your ranked game has started.' : 'Your opponent has made their move.',
      icon: ICON,
      data: { gameId, url: data.url || '/lobby' },
      tag: gameId ? `${isMatchFound ? 'match' : 'turn'}-${gameId}` : 'turn-notification',
      renotify: true,
    },
  };
}

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return; // the SDK has already shown this one — see DISPLAY above
    const { title, options } = buildNotification(payload);
    return self.registration.showNotification(title, options);
  });
} else {
  // Registered without a config (never by the app itself). Install anyway so
  // the page-side notifiers can still show through this registration.
  console.warn('[firebase-messaging-sw] no Firebase config in the worker URL; background push disabled');
}

// Click → focus a tab already on that URL, else open one. The SDK handles the
// click on cards it displayed itself and stops propagation before this runs,
// so this sees only the data-only cards above and the page-side ones the
// Global*Notifier components show through this registration.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/lobby';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});

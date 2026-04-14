// ============================================================
// Push Notification Service
// ============================================================
// Handles push notification registration for both web (FCM) and
// native (Capacitor) platforms. Registers device tokens with the
// backend and handles foreground notification display.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { api } from './api';
import toast from 'react-hot-toast';

let initialized = false;

/**
 * Initialize push notifications. Call once after user authentication.
 * - Web: Uses Firebase Cloud Messaging + service worker
 * - Native (iOS/Android): Uses @capacitor/push-notifications
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
  // Check browser support
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.log('[Push] Browser does not support notifications');
    return;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('[Push] Notification permission denied');
    return;
  }

  try {
    const { initializeApp } = await import('firebase/app');
    const { getMessaging, getToken, onMessage } = await import('firebase/messaging');

    // Firebase config from env vars
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

    // Skip if Firebase config is not set
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.log('[Push] Firebase config not set; skipping web push');
      return;
    }

    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    // Register service worker
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    // Get FCM token
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      // Register token with backend
      await api.post('/users/me/push-tokens', { token, platform: 'web' });
      console.log('[Push] Web push token registered');
    }

    // Handle foreground messages
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "It's your turn!";
      const body = payload.notification?.body ?? '';
      toast(
        `${title}\n${body}`,
        { duration: 8000, icon: '🎮' },
      );
    });
  } catch (err) {
    console.error('[Push] Web push setup failed:', err);
  }
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

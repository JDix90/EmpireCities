import { Capacitor } from '@capacitor/core';

/**
 * Where this build of the game is running: the website, or the iOS or Android
 * app (the Capacitor shell around the same bundle).
 *
 * The device class (utils/device.ts) cannot say: Safari on an iPhone and the
 * iOS app are both a `phone`. The backend keeps the same three values
 * (modules/auth/attribution.ts CLIENT_PLATFORMS).
 */
export type ClientPlatform = 'web' | 'ios' | 'android';

export function clientPlatform(): ClientPlatform {
  // A detection helper that throws would take a signup's attribution with it.
  try {
    if (!Capacitor.isNativePlatform()) return 'web';
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android' ? platform : 'web';
  } catch {
    return 'web';
  }
}

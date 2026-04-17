import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shells load the Vite build from `dist/`.
 * Set VITE_API_URL / VITE_SOCKET_URL when building for production API hosts.
 * iOS: use HTTPS API only (ATS). Android: cleartext disabled by default for release.
 */
const config: CapacitorConfig = {
  /** Unchanged for App Store / Play continuity; a new id is a separate store listing. */
  appId: 'com.chronoconquest.app',
  appName: 'Eras of Empire',
  webDir: 'dist',
  server: {
    // Use https scheme on Android so secure cookies / mixed content behave like production web
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f1117',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';
import { captureAttribution } from './utils/attribution';

// Snapshot first-touch acquisition attribution (utm_* / referrer) before render,
// so it's available for the first guest/register call. See utils/attribution.ts.
captureAttribution();

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  });
}

if (Capacitor.isNativePlatform()) {
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  void StatusBar.setBackgroundColor({ color: '#0f1117' }).catch(() => {});

  // Hardware back button: navigate back or minimize app
  import('@capacitor/app').then(({ App: CapApp }) => {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        CapApp.minimizeApp();
      }
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Toaster lives inside <App /> so it can read network/auth state and
          offset itself when the offline banner is shown or when running on a
          small mobile viewport. See App.tsx. */}
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

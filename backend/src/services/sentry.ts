import * as Sentry from '@sentry/node';
import { config } from '../config';

let initialized = false;

export function initSentry(): void {
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.nodeEnv === 'production' ? 0.2 : 1.0,
  });
  initialized = true;
}

export function captureException(err: unknown): void {
  if (initialized) {
    Sentry.captureException(err);
  }
}

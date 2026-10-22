import * as Sentry from '@sentry/node';
import { config } from '../config';

let initialized = false;

/**
 * Spans not worth sending. A BullMQ worker waits for its next job in a
 * blocking BZPOPMIN that returns after up to 10s with nothing to do, so each
 * worker records one of these every ~10s, all day. They were the top span by
 * total duration in the weekly report (21 days of waiting a week) and say
 * nothing about how fast the game is.
 */
export const IGNORED_SPANS: RegExp[] = [/\bbzpopmin\b/i];

/**
 * Report server errors to Sentry when SENTRY_DSN is set; a no-op otherwise.
 *
 * Three routes in: the process-level handlers in index.ts (crashes and dropped
 * promises), the global request error handler (errorHandler.ts, 5xx only), and
 * every `console.error`. The last one matters because the game socket's
 * handlers catch their own failures and log them with console.error instead of
 * throwing, so without it a broken live-game path never reached Sentry. The
 * release comes from SENTRY_RELEASE, which deploy-production.sh sets to the
 * deployed commit and the SDK reads on its own.
 */
export function initSentry(): void {
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.nodeEnv === 'production' ? 0.2 : 1.0,
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    ignoreSpans: IGNORED_SPANS,
  });
  initialized = true;
}

/** Whether errors are being sent (a DSN was set and `initSentry` ran). */
export function sentryEnabled(): boolean {
  return initialized;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (initialized) {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  }
}

/** Wait for queued events to send. Resolves true when there is nothing to send. */
export async function flushSentry(timeoutMs = 5000): Promise<boolean> {
  return initialized ? Sentry.flush(timeoutMs) : true;
}

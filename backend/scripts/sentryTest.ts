/**
 * Send one test error to Sentry through the server's own reporting path, to
 * confirm SENTRY_DSN is set and reaches the node_borderfall project.
 *
 * On the droplet, after a deploy:
 *   docker exec -w /app/backend borderfall_backend_prod pnpm exec tsx scripts/sentryTest.ts
 *
 * It reads SENTRY_DSN from the running container's environment, which the
 * deploy takes from .env.production. Exits 1 when no DSN is set.
 */
import { captureException, flushSentry, initSentry, sentryEnabled } from '../src/services/sentry';

async function main(): Promise<void> {
  initSentry();
  if (!sentryEnabled()) {
    console.error('SENTRY_DSN is not set in this container: add it to .env.production and deploy.');
    process.exit(1);
  }
  captureException(new Error('Borderfall Sentry test: the server can reach Sentry'), {
    sentAt: new Date().toISOString(),
  });
  const sent = await flushSentry(10_000);
  if (!sent) {
    console.error('Timed out sending to Sentry. Check the droplet can reach sentry.io.');
    process.exit(1);
  }
  console.log('Sent. Look in the node_borderfall project in Sentry for "Borderfall Sentry test".');
}

void main();

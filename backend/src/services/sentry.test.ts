/**
 * The spans dropped before they are sent. A BullMQ worker waiting for its next
 * job (a blocking BZPOPMIN, up to 10s at a time, all day) is not worth a span;
 * every other Redis command still is.
 */
import { describe, it, expect, vi } from 'vitest';

const init = vi.fn();
vi.mock('@sentry/node', () => ({
  init: (...a: unknown[]) => init(...a),
  captureConsoleIntegration: () => ({ name: 'CaptureConsole' }),
  captureException: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('../config', () => ({ config: { sentryDsn: 'https://key@example.invalid/1', nodeEnv: 'production' } }));

import { IGNORED_SPANS, initSentry } from './sentry';

const ignored = (name: string) => IGNORED_SPANS.some((re) => re.test(name));

describe('Sentry spans', () => {
  it('drops a worker waiting for its next job, however the span is named', () => {
    for (const name of ['bzpopmin', 'BZPOPMIN', 'redis-bzpopmin', 'bzpopmin bull:retention-notifications:marker 10']) {
      expect(ignored(name), name).toBe(true);
    }
  });

  it('keeps every other span', () => {
    for (const name of ['get', 'evalsha', 'hset', 'GET /api/games/public', 'redis-evalsha']) {
      expect(ignored(name), name).toBe(false);
    }
  });

  it('is passed to Sentry', () => {
    initSentry();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ ignoreSpans: IGNORED_SPANS }));
  });
});

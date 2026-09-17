/**
 * The client→server event allowlist is the contract between the UI and the
 * funnel. A name the UI sends that is missing here is not an error the UI can
 * see: `api.post(...).catch(() => {})` swallows the 400 and the event simply
 * never lands, so the funnel quietly reads as "nobody ever did this".
 *
 * `tutorial_exited` is covered specifically because it is the only view we
 * have of WHERE players leave the tutorial — `tutorial_started` and
 * `tutorial_completed` are server-side and give the rate, not the step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const recordServerEventMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => recordServerEventMock(...a),
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = 'user-1';
  },
}));

import { analyticsRoutes } from './analytics.routes';

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.ready();
  return app;
}

describe('POST /api/analytics/ui-event', () => {
  beforeEach(() => recordServerEventMock.mockReset());

  it('accepts tutorial_exited with the step it was left on', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: {
        event: 'tutorial_exited',
        properties: {
          via: 'exit_button',
          module: 'core',
          step: 'draft_do',
          step_index: '2',
          step_count: '9',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith(
      'tutorial_exited',
      expect.objectContaining({ via: 'exit_button', step: 'draft_do', step_index: '2' }),
      'user-1',
    );
    await app.close();
  });

  it('still rejects a name that is not on the allowlist', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: { event: 'tutorial_vibes', properties: { step: 'draft_do' } },
    });

    expect(res.statusCode).toBe(400);
    expect(recordServerEventMock).not.toHaveBeenCalled();
    await app.close();
  });
});
